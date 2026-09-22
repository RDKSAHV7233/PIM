import { NotFoundException } from "@nestjs/common";
import { RuleSeverity, RuleType, ValidationIssueStatus } from "@prisma/client";
import { ComplianceService } from "./compliance.service";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

type ProductStub = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  brand: string;
  hsnCode: string | null;
  gstRate: number | null;
  attributes: Record<string, unknown>;
  category: { id: string };
  vendorScopeKey?: string | null;
};

type AttributeDefStub = {
  key: string;
  name: string;
  required: boolean;
  dataType: string;
  allowedValues: unknown[];
  appliesTo: string;
};

type ComplianceRuleStub = {
  id: string;
  ruleCode: string;
  ruleType: string;
  severity: string;
  active: boolean;
  categoryId: string | null;
  config: Record<string, unknown>;
};

function makeProduct(overrides: Partial<ProductStub> = {}): ProductStub {
  return {
    id: "prod_1",
    categoryId: "cat_1",
    title: "Test Product",
    description: "A test product",
    brand: "TestBrand",
    hsnCode: "1234",
    gstRate: 18,
    attributes: {},
    category: { id: "cat_1" },
    ...overrides,
  };
}

type PricingMocks = {
  /** The default active price list to return, or null if none configured. */
  defaultPriceList?: { id: string; name: string } | null;
  /** Variants to return for the product, each with a prices[] sub-array. */
  variants?: { id: string; prices: { id: string }[] }[];
};

function makeService(
  product: ProductStub | null,
  attrDefs: AttributeDefStub[] = [],
  rules: ComplianceRuleStub[] = [],
  pricing: PricingMocks = {},
) {
  const deleteManyMock = jest.fn().mockResolvedValue({ count: 0 });
  const createManyMock = jest.fn().mockResolvedValue({ count: 0 });

  const txMock = jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb({ validationIssue: { deleteMany: deleteManyMock, createMany: createManyMock } });
  });

  // Default pricing to "no price list configured" → collectPricingIssues returns [] so
  // existing tests are unaffected.
  const defaultPriceList = "defaultPriceList" in pricing ? pricing.defaultPriceList : null;
  const variants = pricing.variants ?? [];

  const prisma = {
    tenant: jest.fn().mockReturnValue({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
      },
      $transaction: txMock,
    }),
  };

  const accessPolicy = {
    assertProductAccess: jest.fn().mockResolvedValue(undefined),
  };

  // cache.getOrSet calls the producer immediately (transparent passthrough)
  const cache = {
    getOrSet: jest.fn().mockImplementation(
      (_key: string, _ttl: number, producer: () => Promise<unknown>) => producer(),
    ),
  };

  // Wire attribute-defs, rules, and pricing mocks into the prisma tenant mock.
  (prisma.tenant as jest.Mock).mockReturnValue({
    product: {
      findUnique: jest.fn().mockResolvedValue(product),
    },
    attributeDefinition: {
      findMany: jest.fn().mockResolvedValue(attrDefs),
    },
    complianceRule: {
      findMany: jest.fn().mockResolvedValue(rules),
    },
    priceList: {
      findFirst: jest.fn().mockResolvedValue(defaultPriceList),
    },
    variant: {
      findMany: jest.fn().mockResolvedValue(variants),
    },
    $transaction: txMock,
  });

  const service = new ComplianceService(prisma as never, accessPolicy as never, cache as never);

  return { service, createManyMock, deleteManyMock };
}

// ---------------------------------------------------------------------------
// GST / HSN checks
// ---------------------------------------------------------------------------

describe("ComplianceService — GST/HSN checks", () => {
  it("emits GST_HSN_REQUIRED when hsnCode is null", async () => {
    const { service, createManyMock } = makeService(makeProduct({ hsnCode: null }));
    const result = await service.validateAndPersistProduct("prod_1");
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("GST_HSN_REQUIRED");
  });

  it("emits GST_HSN_REQUIRED when hsnCode is empty string", async () => {
    const { service, createManyMock } = makeService(makeProduct({ hsnCode: "   " }));
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("GST_HSN_REQUIRED");
  });

  it.each(["12", "12345", "1234567", "123456789"])(
    "emits GST_HSN_FORMAT for invalid HSN length %p",
    async (hsn) => {
      const { service, createManyMock } = makeService(makeProduct({ hsnCode: hsn }));
      await service.validateAndPersistProduct("prod_1");
      const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
      expect(codes).toContain("GST_HSN_FORMAT");
    },
  );

  it.each(["1234", "123456", "12345678"])(
    "accepts valid 4/6/8-digit HSN code %p with no HSN error",
    async (hsn) => {
      const { service, createManyMock } = makeService(makeProduct({ hsnCode: hsn, gstRate: 18 }));
      await service.validateAndPersistProduct("prod_1");
      const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
      const hsnCodes = data.map((d) => d.ruleCode).filter((c) => c.startsWith("GST_HSN"));
      expect(hsnCodes).toHaveLength(0);
    },
  );

  it("emits GST_RATE_REQUIRED when gstRate is null", async () => {
    const { service, createManyMock } = makeService(makeProduct({ gstRate: null }));
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("GST_RATE_REQUIRED");
  });

  it("emits GST_RATE_UNCOMMON warning (not error) for non-standard rate", async () => {
    const { service, createManyMock } = makeService(makeProduct({ gstRate: 7 }));
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string; severity: string }[];
    const uncommon = data.find((d) => d.ruleCode === "GST_RATE_UNCOMMON");
    expect(uncommon).toBeDefined();
    expect(uncommon?.severity).toBe(RuleSeverity.warning);
  });

  it.each([0, 3, 5, 12, 18, 28])(
    "accepts standard GST rate %d with no GST rate error",
    async (rate) => {
      const { service, createManyMock } = makeService(makeProduct({ gstRate: rate }));
      await service.validateAndPersistProduct("prod_1");
      const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
      const gstRateCodes = data.map((d) => d.ruleCode).filter((c) => c.startsWith("GST_RATE"));
      expect(gstRateCodes).toHaveLength(0);
    },
  );

  it("throws NotFoundException when product does not exist", async () => {
    const { service } = makeService(null);
    await expect(service.validateAndPersistProduct("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Dynamic attribute checks
// ---------------------------------------------------------------------------

describe("ComplianceService — attribute definition checks", () => {
  it("emits ATTR_REQUIRED_* error when a required attribute is missing", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "colour", name: "Colour", required: true, dataType: "text", allowedValues: [], appliesTo: "product" },
    ];
    const { service, createManyMock } = makeService(makeProduct({ attributes: {} }), attrDefs);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("ATTR_REQUIRED_COLOUR");
  });

  it("does not emit required error when the attribute is present", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "colour", name: "Colour", required: true, dataType: "text", allowedValues: [], appliesTo: "product" },
    ];
    const { service, createManyMock } = makeService(makeProduct({ attributes: { colour: "Red" } }), attrDefs);
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
    expect(data.map((d) => d.ruleCode)).not.toContain("ATTR_REQUIRED_COLOUR");
  });

  it("emits ATTR_TYPE_* error when value fails data type check", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "weight", name: "Weight", required: false, dataType: "number", allowedValues: [], appliesTo: "product" },
    ];
    const { service, createManyMock } = makeService(makeProduct({ attributes: { weight: "heavy" } }), attrDefs);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("ATTR_TYPE_WEIGHT");
  });

  it("emits ATTR_ALLOWED_* warning when value is not in allowedValues list", async () => {
    const attrDefs: AttributeDefStub[] = [
      {
        key: "size",
        name: "Size",
        required: false,
        dataType: "text",
        allowedValues: ["S", "M", "L"],
        appliesTo: "product",
      },
    ];
    const { service, createManyMock } = makeService(makeProduct({ attributes: { size: "XL" } }), attrDefs);
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string; severity: string }[];
    const allowedIssue = data.find((d) => d.ruleCode === "ATTR_ALLOWED_SIZE");
    expect(allowedIssue).toBeDefined();
    expect(allowedIssue?.severity).toBe(RuleSeverity.warning);
  });

  it("does not emit type or allowed errors for missing optional attributes", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "colour", name: "Colour", required: false, dataType: "text", allowedValues: ["Red", "Blue"], appliesTo: "product" },
    ];
    const { service, createManyMock } = makeService(makeProduct({ attributes: {} }), attrDefs);
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
    const colourCodes = data.map((d) => d.ruleCode).filter((c) => c.includes("COLOUR"));
    expect(colourCodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Compliance rule checks
// ---------------------------------------------------------------------------

describe("ComplianceService — compliance rule checks", () => {
  const baseRule: ComplianceRuleStub = {
    id: "rule_1",
    ruleCode: "RULE_TITLE_REQUIRED",
    ruleType: RuleType.required_field,
    severity: RuleSeverity.error,
    active: true,
    categoryId: null,
    config: { field: "title", message: "Title is required." },
  };

  it("emits a rule issue when a required_field rule fails", async () => {
    const rule = { ...baseRule, config: { field: "title", message: "Title is required." } };
    const { service, createManyMock } = makeService(makeProduct({ title: "" }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("RULE_TITLE_REQUIRED");
  });

  it("does not emit a rule issue when the required_field is present", async () => {
    const rule = { ...baseRule };
    const { service, createManyMock } = makeService(makeProduct({ title: "Valid Title" }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
    expect(data.map((d) => d.ruleCode)).not.toContain("RULE_TITLE_REQUIRED");
  });

  it("emits a rule issue when a regex_field rule fails", async () => {
    const rule: ComplianceRuleStub = {
      ...baseRule,
      ruleCode: "RULE_BRAND_ALPHA",
      ruleType: RuleType.regex_field,
      config: { field: "brand", pattern: "^[A-Za-z]+$", message: "Brand must be alphabetic." },
    };
    const { service, createManyMock } = makeService(makeProduct({ brand: "Brand123" }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("RULE_BRAND_ALPHA");
  });

  it("does not emit a regex_field issue when the value matches the pattern", async () => {
    const rule: ComplianceRuleStub = {
      ...baseRule,
      ruleCode: "RULE_BRAND_ALPHA",
      ruleType: RuleType.regex_field,
      config: { field: "brand", pattern: "^[A-Za-z]+$" },
    };
    const { service, createManyMock } = makeService(makeProduct({ brand: "GoodBrand" }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const data = (createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[];
    expect(data.map((d) => d.ruleCode)).not.toContain("RULE_BRAND_ALPHA");
  });

  it("emits a rule issue when a value_in_set rule fails", async () => {
    const rule: ComplianceRuleStub = {
      ...baseRule,
      ruleCode: "RULE_BRAND_ALLOWED",
      ruleType: RuleType.value_in_set,
      config: { field: "brand", values: ["Nike", "Adidas"], message: "Brand not allowed." },
    };
    const { service, createManyMock } = makeService(makeProduct({ brand: "Unknown" }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("RULE_BRAND_ALLOWED");
  });

  it("resolves attribute fields via 'attributes.<key>' path in config", async () => {
    const rule: ComplianceRuleStub = {
      ...baseRule,
      ruleCode: "RULE_COLOUR_REQUIRED",
      ruleType: RuleType.required_field,
      config: { field: "attributes.colour", message: "Colour is required." },
    };
    const { service, createManyMock } = makeService(makeProduct({ attributes: {} }), [], [rule]);
    await service.validateAndPersistProduct("prod_1");
    const codes = (createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[] ?? []).map((d) => d.ruleCode);
    expect(codes).toContain("RULE_COLOUR_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Parallelism (P0-A): both check paths run and their issues are merged
// ---------------------------------------------------------------------------

describe("ComplianceService — parallel check paths (P0-A)", () => {
  it("collects issues from both attribute defs AND compliance rules in a single call", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "colour", name: "Colour", required: true, dataType: "text", allowedValues: [], appliesTo: "product" },
    ];
    const rules: ComplianceRuleStub[] = [
      {
        id: "rule_2",
        ruleCode: "RULE_BRAND_ALPHA",
        ruleType: RuleType.regex_field,
        severity: RuleSeverity.warning,
        active: true,
        categoryId: null,
        config: { field: "brand", pattern: "^[A-Za-z]+$" },
      },
    ];
    const { service, createManyMock } = makeService(
      makeProduct({ attributes: {}, brand: "Brand123" }),
      attrDefs,
      rules,
    );
    const result = await service.validateAndPersistProduct("prod_1");

    // Both paths ran — issues from both should appear
    const allCodes = result.issues.map((i) => i.ruleCode);
    expect(allCodes).toContain("ATTR_REQUIRED_COLOUR"); // from attribute path
    expect(allCodes).toContain("RULE_BRAND_ALPHA");     // from compliance rule path

    // The transaction received all issues combined
    const persistedData = createManyMock.mock.calls[0]?.[0]?.data as { ruleCode: string }[];
    expect(persistedData.map((d) => d.ruleCode)).toContain("ATTR_REQUIRED_COLOUR");
    expect(persistedData.map((d) => d.ruleCode)).toContain("RULE_BRAND_ALPHA");
  });

  it("returns zero issues for a fully compliant product", async () => {
    const attrDefs: AttributeDefStub[] = [
      { key: "colour", name: "Colour", required: true, dataType: "text", allowedValues: [], appliesTo: "product" },
    ];
    const { service, deleteManyMock, createManyMock } = makeService(
      makeProduct({ hsnCode: "1234", gstRate: 18, attributes: { colour: "Blue" } }),
      attrDefs,
      [],
    );
    const result = await service.validateAndPersistProduct("prod_1");

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.issues).toHaveLength(0);

    // Transaction still runs to clear stale issues
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    // createMany is NOT called when there are no issues
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("persists issues with correct ValidationIssueStatus.open", async () => {
    const { service, createManyMock } = makeService(makeProduct({ hsnCode: null }));
    await service.validateAndPersistProduct("prod_1");
    const data = createManyMock.mock.calls[0]?.[0]?.data as { status: string }[];
    expect(data.every((d) => d.status === ValidationIssueStatus.open)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pricing checks
// ---------------------------------------------------------------------------

describe("ComplianceService — pricing checks", () => {
  const defaultPriceList = { id: "pl_1", name: "India Default" };

  it("emits no pricing issues when no default price list is configured", async () => {
    // defaultPriceList: null → skip pricing check
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      { defaultPriceList: null },
    );
    await service.validateAndPersistProduct("prod_1");
    const codes = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[]).map((d) => d.ruleCode);
    expect(codes).not.toContain("PRICING_NO_DEFAULT_PRICES");
    expect(codes).not.toContain("PRICING_INCOMPLETE");
  });

  it("emits no pricing issues when the product has no variants yet", async () => {
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      { defaultPriceList, variants: [] },
    );
    await service.validateAndPersistProduct("prod_1");
    const codes = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[]).map((d) => d.ruleCode);
    expect(codes).not.toContain("PRICING_NO_DEFAULT_PRICES");
    expect(codes).not.toContain("PRICING_INCOMPLETE");
  });

  it("emits no pricing issues when all variants are priced", async () => {
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      {
        defaultPriceList,
        variants: [
          { id: "v1", prices: [{ id: "pp1" }] },
          { id: "v2", prices: [{ id: "pp2" }] },
        ],
      },
    );
    await service.validateAndPersistProduct("prod_1");
    const codes = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[]).map((d) => d.ruleCode);
    expect(codes).not.toContain("PRICING_NO_DEFAULT_PRICES");
    expect(codes).not.toContain("PRICING_INCOMPLETE");
  });

  it("emits PRICING_NO_DEFAULT_PRICES warning when zero variants are priced", async () => {
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      {
        defaultPriceList,
        variants: [
          { id: "v1", prices: [] },
          { id: "v2", prices: [] },
        ],
      },
    );
    await service.validateAndPersistProduct("prod_1");
    const data = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string; severity: string; fieldPath: string }[]);
    const issue = data.find((d) => d.ruleCode === "PRICING_NO_DEFAULT_PRICES");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe(RuleSeverity.warning);
    expect(issue?.fieldPath).toBe("pricing");
  });

  it("emits PRICING_INCOMPLETE warning when some variants are unpriced", async () => {
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      {
        defaultPriceList,
        variants: [
          { id: "v1", prices: [{ id: "pp1" }] }, // priced
          { id: "v2", prices: [] },               // unpriced
          { id: "v3", prices: [] },               // unpriced
        ],
      },
    );
    await service.validateAndPersistProduct("prod_1");
    const data = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string; severity: string; message: string }[]);
    const issue = data.find((d) => d.ruleCode === "PRICING_INCOMPLETE");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe(RuleSeverity.warning);
    // Message should mention 2 unpriced out of 3 total
    expect(issue?.message).toContain("2");
    expect(issue?.message).toContain("3");
  });

  it("does not emit PRICING_NO_DEFAULT_PRICES when PRICING_INCOMPLETE was emitted (no double-firing)", async () => {
    const { service, createManyMock } = makeService(
      makeProduct(),
      [],
      [],
      {
        defaultPriceList,
        variants: [
          { id: "v1", prices: [{ id: "pp1" }] },
          { id: "v2", prices: [] },
        ],
      },
    );
    await service.validateAndPersistProduct("prod_1");
    const codes = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[]).map((d) => d.ruleCode);
    expect(codes).toContain("PRICING_INCOMPLETE");
    expect(codes).not.toContain("PRICING_NO_DEFAULT_PRICES");
  });

  it("pricing warning appears alongside GST issues in the merged result", async () => {
    const { service, createManyMock } = makeService(
      makeProduct({ hsnCode: null }), // triggers GST_HSN_REQUIRED
      [],
      [],
      {
        defaultPriceList,
        variants: [{ id: "v1", prices: [] }], // triggers PRICING_NO_DEFAULT_PRICES
      },
    );
    const result = await service.validateAndPersistProduct("prod_1");
    const allCodes = result.issues.map((i) => i.ruleCode);
    expect(allCodes).toContain("GST_HSN_REQUIRED");
    expect(allCodes).toContain("PRICING_NO_DEFAULT_PRICES");

    const persistedCodes = ((createManyMock.mock.calls[0]?.[0]?.data ?? []) as { ruleCode: string }[]).map((d) => d.ruleCode);
    expect(persistedCodes).toContain("GST_HSN_REQUIRED");
    expect(persistedCodes).toContain("PRICING_NO_DEFAULT_PRICES");
  });
});

// ---------------------------------------------------------------------------
// listIssueInbox — installation-scope product cap (silent-truncation fix)
// ---------------------------------------------------------------------------
//
// installationId-scoped queries resolve distinct productIds via an IN-clause
// capped at 10,000 rows (a real Prisma relation from ConnectorSubmission to
// Product doesn't exist yet — see the TODO in listIssueInbox()). Before this
// fix, an installation with MORE than 10,000 distinct products would silently
// return an incomplete issue list with no indication anything was cut off.
// These tests cover: the cap is surfaced via installationScopeTruncated,
// results below the cap are correctly reported as NOT truncated, and the
// fetch is now deterministically ordered.

type ValidationIssueRowStub = {
  id: string;
  productId: string;
  fieldPath: string | null;
  severity: "error" | "warning";
  message: string;
  createdAt: Date;
  product: {
    title: string;
    status: string;
    categoryId: string;
    category: { name: string } | null;
    variants: { skuCode: string }[];
  };
};

function makeIssueRow(overrides: Partial<ValidationIssueRowStub> = {}): ValidationIssueRowStub {
  return {
    id: "issue_1",
    productId: "prod_1",
    fieldPath: "title",
    severity: "error",
    message: "Title is required.",
    createdAt: new Date("2026-09-16T00:00:00.000Z"),
    product: {
      title: "Test Product",
      status: "draft",
      categoryId: "cat_1",
      category: { name: "Test Category" },
      variants: [{ skuCode: "SKU-1" }],
    },
    ...overrides,
  };
}

function makeIssueInboxService(options: {
  installation?: { id: string; accountAlias: string; connectorSlug: string | null } | null;
  connectorSubmissionRows?: Array<{ productId: string }>;
  validationIssueRows?: ValidationIssueRowStub[];
}) {
  const installation = "installation" in options ? options.installation : { id: "inst_1", accountAlias: "acme-store", connectorSlug: "woocommerce" };
  const queryRawMock = jest.fn().mockResolvedValue(installation ? [installation] : []);
  const connectorSubmissionFindMany = jest.fn().mockResolvedValue(options.connectorSubmissionRows ?? []);
  const validationIssueFindMany = jest.fn().mockResolvedValue(options.validationIssueRows ?? []);
  const validationIssueCount = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0);

  const prisma = {
    tenant: jest.fn().mockReturnValue({
      $queryRaw: queryRawMock,
      connectorSubmission: { findMany: connectorSubmissionFindMany },
      validationIssue: { findMany: validationIssueFindMany, count: validationIssueCount },
    }),
  };

  const accessPolicy = {
    assertConnectorInstallationAccess: jest.fn().mockResolvedValue(undefined),
    buildProductScopeWhere: jest.fn().mockResolvedValue(null),
  };

  const cache = { getOrSet: jest.fn() };

  const service = new ComplianceService(prisma as never, accessPolicy as never, cache as never);
  return { service, connectorSubmissionFindMany, validationIssueFindMany, accessPolicy, queryRawMock, tenantMock: prisma.tenant };
}

describe("ComplianceService.listIssueInbox — installation-scope product cap", () => {
  it("reports installationScopeTruncated: false when the installation has fewer products than the cap", async () => {
    const { service } = makeIssueInboxService({
      connectorSubmissionRows: [{ productId: "prod_1" }, { productId: "prod_2" }],
      validationIssueRows: [makeIssueRow()],
    });

    const result = await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(result.installationScopeTruncated).toBe(false);
  });

  it("does NOT false-positive truncation when the installation has EXACTLY the cap's worth of distinct products", async () => {
    // Regression guard: a plain `take: CAP` can't distinguish "exactly CAP
    // matching rows" from "more than CAP, silently cut off here" — this must
    // fetch CAP+1 and only report truncated when it actually gets more than
    // CAP rows back, mirroring the audit-export truncation fix's CAP+1
    // pattern (fixed here after review found the original `length === CAP`
    // check would flag a real, complete, exactly-10,000-product installation
    // as truncated when nothing was actually cut off).
    const exactlyCappedRows = Array.from({ length: 10_000 }, (_, i) => ({ productId: `prod_${i}` }));
    const { service } = makeIssueInboxService({
      connectorSubmissionRows: exactlyCappedRows,
      validationIssueRows: [makeIssueRow()],
    });

    const result = await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(result.installationScopeTruncated).toBe(false);
  });

  it("reports installationScopeTruncated: true, and caps the productId filter at exactly 10,000, when the fetch finds more than 10,000 distinct products", async () => {
    const overCappedRows = Array.from({ length: 10_001 }, (_, i) => ({ productId: `prod_${i}` }));
    const { service, validationIssueFindMany } = makeIssueInboxService({
      connectorSubmissionRows: overCappedRows,
      validationIssueRows: [makeIssueRow()],
    });

    const result = await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(result.installationScopeTruncated).toBe(true);
    const passedFilter = validationIssueFindMany.mock.calls[0][0];
    const andClauses: Array<{ productId?: { in: string[] } }> = passedFilter.where.AND;
    const productIdFilter = andClauses.find((clause) => Boolean(clause.productId));
    expect(productIdFilter?.productId?.in).toHaveLength(10_000);
  });

  it("fetches CAP+1 distinct productIds with a deterministic orderBy, not the DB's unspecified default order", async () => {
    const { service, connectorSubmissionFindMany } = makeIssueInboxService({
      connectorSubmissionRows: [{ productId: "prod_1" }],
      validationIssueRows: [makeIssueRow()],
    });

    await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(connectorSubmissionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { productId: "asc" }, take: 10_001 }),
    );
  });

  it("reports installationScopeTruncated: false on the empty-result path (installation not found)", async () => {
    const { service } = makeIssueInboxService({ installation: null });

    const result = await service.listIssueInbox({ installationId: "inst_missing" } as never);

    expect(result.items).toEqual([]);
    expect(result.installationScopeTruncated).toBe(false);
  });

  it("reports installationScopeTruncated: false on the empty-result path (installation has zero products)", async () => {
    const { service } = makeIssueInboxService({ connectorSubmissionRows: [] });

    const result = await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(result.items).toEqual([]);
    expect(result.installationScopeTruncated).toBe(false);
  });

  it("reports installationScopeTruncated: false when no installationId filter is given at all", async () => {
    const { service } = makeIssueInboxService({ validationIssueRows: [makeIssueRow()] });

    const result = await service.listIssueInbox({} as never);

    expect(result.installationScopeTruncated).toBe(false);
  });
});

// Regression test for a real cross-tenant information-disclosure bug found 2026-09-20:
// loadInstallationScopeCandidate()'s raw SQL never carried a tenant_key filter at all,
// despite taking tenantKey as a parameter — an installationId belonging to a DIFFERENT
// tenant would resolve successfully instead of correctly returning null. For an admin
// actor, the caller's own assertConnectorInstallationAccess() check is a no-op
// (`if (this.isAdmin(actor)) return;`), so the leak reached the caller unfiltered:
// the OTHER tenant's installation id/accountAlias/connectorSlug were disclosable.
// The mocked $queryRaw in the tests above can't prove this fix — it just returns
// whatever `installation` stub was handed to it regardless of the real SQL text — so
// this describe block instead asserts on the actual Prisma.sql object the code sends.
describe("ComplianceService.listIssueInbox — installation-scope raw query must be tenant-scoped (no prior coverage)", () => {
  it("sends a tenant_key filter to $queryRaw when resolving the installation-scope candidate", async () => {
    const { service, queryRawMock } = makeIssueInboxService({
      installation: { id: "inst_1", accountAlias: "acme-store", connectorSlug: "woocommerce" },
      validationIssueRows: [],
    });

    await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawMock.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sqlArg.sql).toContain("tenant_key");
    // "default" is what getTenantKeyFromContext() normalizes to outside a real request
    // context — same convention every other raw-SQL regression test in this session uses.
    expect(sqlArg.values).toContain("default");
  });

  it("resolves the tenant client for the current tenant before issuing the raw query", async () => {
    const { service, tenantMock } = makeIssueInboxService({
      installation: { id: "inst_1", accountAlias: "acme-store", connectorSlug: "woocommerce" },
      validationIssueRows: [],
    });

    await service.listIssueInbox({ installationId: "inst_1" } as never);

    expect(tenantMock).toHaveBeenCalledWith("default");
  });
});

// F-018: an open ValidationIssue for a soft-deleted product used to sit in the Issue
// Inbox forever, its "Fix Now" link pointing at a product page that 404s (getProduct's
// soft-delete scope excludes it). CatalogService.deleteProduct() now calls this right
// alongside the existing NotificationsService.retargetProductNotifications() call.
describe("ComplianceService.resolveOpenIssuesForDeletedProduct (F-018)", () => {
  function makeResolveService() {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        validationIssue: { updateMany: updateManyMock },
      }),
    };
    const accessPolicy = {};
    const cache = {};
    const service = new ComplianceService(prisma as never, accessPolicy as never, cache as never);
    return { service, updateManyMock, tenantMock: prisma.tenant };
  }

  it("resolves only this product's open issues, scoped to the current tenant", async () => {
    const { service, updateManyMock, tenantMock } = makeResolveService();

    const result = await service.resolveOpenIssuesForDeletedProduct("prod_deleted_1");

    expect(tenantMock).toHaveBeenCalledWith("default");
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { tenantKey: "default", productId: "prod_deleted_1", status: ValidationIssueStatus.open },
      data: { status: ValidationIssueStatus.resolved },
    });
    expect(result).toEqual({ resolved: 2 });
  });

  it("short-circuits on an empty productId without touching Prisma", async () => {
    const { service, updateManyMock, tenantMock } = makeResolveService();

    const result = await service.resolveOpenIssuesForDeletedProduct("   ");

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(tenantMock).not.toHaveBeenCalled();
    expect(result).toEqual({ resolved: 0 });
  });
});
