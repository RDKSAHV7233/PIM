// bigcommerce-create-reconcile.spec.ts
//
// Sprint 3, PR 3b-B. A failed export job is replayed from the top, and BigCommerce has no
// idempotency key. The fake store below behaves as BigCommerce's published spec describes: a create
// whose SKU or name is already taken answers 409. It can also EXECUTE a create and then lose the
// response. The invariants: a replay of a create that already happened is returned as the existing
// product (not reported as a failure), the store never holds two products for one SKU, and a
// product that merely shares the SKU is never reported as published.

import { ConnectorNetworkError } from "../../connector-framework/connector.errors";
import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { BigCommerceConnector, BigCommercePublishError } from "./bigcommerce.connector";

const TEST_KEY = "d".repeat(64);

const product: ProductPayload = {
  sku: "BC-001",
  title: "BigCommerce mapped product",
  description: "A widget",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 19.99,
  mainImageUrl: "https://cdn.example.com/bc.jpg",
  attributes: { weight_kg: 1.2 },
  productType: "generic",
};

const ctx = {
  tenantId: "t1",
  installationId: "i1",
  connectorId: "bigcommerce",
  getAccessToken: jest.fn().mockResolvedValue("unused"),
} as unknown as ConnectorContext;

interface StoreProduct { id: number; name: string; sku: string }

type CreateFate = "ok" | "lose_response" | "http_503";

class FakeStore {
  products: StoreProduct[] = [];
  nextId = 100;
  createAttempts = 0;
  lookups = 0;
  /** What happens to the response of each create, in order; defaults to "ok". */
  fates: CreateFate[] = [];
  /** Fail the next lookup with this status. */
  lookupStatus: number | null = null;
  /** Make the lookup return rows regardless of the requested SKU (a filter that is ignored). */
  ignoreSkuFilter = false;
  /** Run once, right before the next create is evaluated: another attempt completing in the meantime. */
  beforeNextCreate: (() => void) | null = null;

  fetch = jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      this.createAttempts += 1;
      this.beforeNextCreate?.();
      this.beforeNextCreate = null;
      const body = JSON.parse(String(init.body));
      const taken = this.products.some((p) => p.sku === body.sku || p.name === body.name);
      if (taken) {
        return json(409, { status: 409, title: "DuplicateSKUError", errors: { sku: "The product SKU is a duplicate." } });
      }
      const created: StoreProduct = { id: this.nextId++, name: body.name, sku: body.sku };
      this.products.push(created);
      const fate = this.fates.shift() ?? "ok";
      if (fate === "lose_response") throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      if (fate === "http_503") return json(503, {});
      return json(201, { data: { id: created.id } });
    }
    this.lookups += 1;
    if (this.lookupStatus) return json(this.lookupStatus, { title: "Unauthorized" });
    const sku = new URL(url).searchParams.get("sku");
    const rows = this.products.filter((p) => this.ignoreSkuFilter || p.sku === sku);
    return json(200, { data: rows });
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeConnector() {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  const credRow = (type: string, value: string) => ({
    credentialType: type,
    encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`,
    keyVersion: "v1",
  });
  const rows: Record<string, ReturnType<typeof credRow>> = {
    store_hash: credRow("store_hash", "abc123"),
    api_key: credRow("api_key", "real-store-api-token"),
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  const connector = new BigCommerceConnector(
    { getClient: () => ({ connectorCredential: { findFirst: jest.fn(({ where }: { where: { credentialType: string } }) => Promise.resolve(rows[where.credentialType] ?? null)) } }) } as never,
    log as never,
  );
  return { connector, log };
}

function useStore(store: FakeStore) {
  jest
    .spyOn(require("../../connector-installer/credential-encryption.util"), "decryptCredentialValue")
    .mockImplementation((enc: unknown) => Buffer.from(String(enc).replace("enc::v1:", ""), "base64").toString("utf8"));
  (global as { fetch: unknown }).fetch = store.fetch;
}

async function attempt(connector: BigCommerceConnector) {
  try {
    return { ok: true as const, ref: await connector.publishProduct(ctx, product) };
  } catch (error) {
    return { ok: false as const, error };
  }
}

afterEach(() => {
  jest.restoreAllMocks();
  (global as { fetch: unknown }).fetch = undefined;
});

describe("BigCommerce create: replay after a lost response", () => {
  it("the replay returns the product the first attempt created, instead of failing with a duplicate", async () => {
    const store = new FakeStore();
    store.fates = ["lose_response"];
    useStore(store);
    const { connector, log } = makeConnector();

    const first = await attempt(connector);
    expect(first.ok).toBe(false);
    expect((first as { error: unknown }).error).toBeInstanceOf(ConnectorNetworkError); // what makes the job replay
    expect(store.products).toHaveLength(1); // the provider did execute it

    const replay = await attempt(connector); // the export job runs again from the top

    expect(replay).toMatchObject({ ok: true, ref: { externalRef: "100", status: "SUCCESS" } });
    expect(store.products).toHaveLength(1);
    expect(store.createAttempts).toBe(1); // the replay never sent a second create
    expect(log.info).toHaveBeenCalledWith(
      "bigcommerce.create.reconciled_existing",
      expect.objectContaining({ sku: "BC-001", externalRef: "100", via: "lookup_before_create" }),
    );
  });

  it("a 5xx after execution is reconciled the same way on replay", async () => {
    const store = new FakeStore();
    store.fates = ["http_503"];
    useStore(store);
    const { connector } = makeConnector();

    const first = await attempt(connector);
    expect(first.ok).toBe(false);

    const replay = await attempt(connector);

    expect(replay).toMatchObject({ ok: true, ref: { externalRef: "100" } });
    expect(store.createAttempts).toBe(1);
  });

  it("repeated replays are stable: still one product, still one create", async () => {
    const store = new FakeStore();
    store.fates = ["lose_response"];
    useStore(store);
    const { connector } = makeConnector();

    await attempt(connector);
    for (let i = 0; i < 3; i++) {
      expect(await attempt(connector)).toMatchObject({ ok: true, ref: { externalRef: "100" } });
    }

    expect(store.products).toHaveLength(1);
    expect(store.createAttempts).toBe(1);
  });
});

describe("BigCommerce create: another attempt finishes between the lookup and the create", () => {
  it("a 409 is followed by a second lookup and reconciled, not reported as a failure", async () => {
    const store = new FakeStore();
    // The lookup above found nothing; before our create is evaluated, the earlier attempt lands.
    store.beforeNextCreate = () => store.products.push({ id: 100, name: "BigCommerce mapped product", sku: "BC-001" });
    useStore(store);
    const { connector, log } = makeConnector();

    const result = await attempt(connector);

    expect(result).toMatchObject({ ok: true, ref: { externalRef: "100", status: "SUCCESS" } });
    expect(store.products).toHaveLength(1);
    expect(store.lookups).toBe(2);
    expect(log.info).toHaveBeenCalledWith(
      "bigcommerce.create.reconciled_existing",
      expect.objectContaining({ via: "conflict_after_create" }),
    );
  });
});

describe("BigCommerce create: a product that only shares the SKU is somebody else's", () => {
  it("is never reported as published, and nothing is created", async () => {
    const store = new FakeStore();
    store.products.push({ id: 7, name: "A merchant-made product", sku: "BC-001" });
    useStore(store);
    const { connector, log } = makeConnector();

    const result = await attempt(connector);

    expect(result.ok).toBe(false);
    const error = (result as { error: BigCommercePublishError }).error;
    expect(error).toBeInstanceOf(BigCommercePublishError);
    expect(error.issues[0]).toMatchObject({ code: "DuplicateSKUError", fieldPath: "sku" });
    expect(store.createAttempts).toBe(0);
    expect(store.products).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "bigcommerce.create.sku_conflict_not_reconciled",
      expect.objectContaining({ existingId: 7, via: "lookup_before_create" }),
    );
  });

  it("a 409 with a mismatched product at that SKU surfaces the original conflict", async () => {
    const store = new FakeStore();
    store.beforeNextCreate = () => store.products.push({ id: 7, name: "A merchant-made product", sku: "BC-001" });
    useStore(store);
    const { connector } = makeConnector();

    const result = await attempt(connector);

    expect(result.ok).toBe(false);
    expect((result as { error: BigCommercePublishError }).error.issues[0].code).toBe("DuplicateSKUError");
    expect(store.products).toHaveLength(1);
  });

  it("a 409 for a name clash with a product under a DIFFERENT sku stays a failure (no SKU match to reconcile)", async () => {
    const store = new FakeStore();
    store.products.push({ id: 7, name: "BigCommerce mapped product", sku: "OTHER-SKU" });
    useStore(store);
    const { connector } = makeConnector();

    const result = await attempt(connector);

    expect(result.ok).toBe(false);
    expect(store.createAttempts).toBe(1);
    expect(store.products).toHaveLength(1);
  });
});

describe("BigCommerce create: the lookup itself", () => {
  it("a failing lookup stops before anything is created", async () => {
    const store = new FakeStore();
    store.lookupStatus = 401;
    useStore(store);
    const { connector } = makeConnector();

    const result = await attempt(connector);

    expect(result.ok).toBe(false);
    expect(store.createAttempts).toBe(0);
  });

  it("only an exact SKU match counts, even if the filter returned other rows", async () => {
    const store = new FakeStore();
    store.products.push({ id: 7, name: "BigCommerce mapped product", sku: "BC-0010" });
    store.ignoreSkuFilter = true;
    useStore(store);
    const { connector } = makeConnector();

    const result = await attempt(connector);

    // The only row has a different SKU, so there is nothing to reconcile with and the create proceeds;
    // the store then rejects it as a name clash.
    expect(store.createAttempts).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("skips the lookup for an empty SKU (BigCommerce does not enforce uniqueness on it)", async () => {
    const store = new FakeStore();
    useStore(store);
    const { connector } = makeConnector();

    const result = await connector.publishProduct(ctx, { ...product, sku: "" }).then(
      (ref) => ({ ok: true as const, ref }),
      (error) => ({ ok: false as const, error }),
    );

    expect(result.ok).toBe(true);
    expect(store.lookups).toBe(0);
    expect(store.createAttempts).toBe(1);
  });

  it("the normal first publish does one lookup and one create", async () => {
    const store = new FakeStore();
    useStore(store);
    const { connector } = makeConnector();

    const result = await attempt(connector);

    expect(result).toMatchObject({ ok: true, ref: { externalRef: "100" } });
    expect(store.lookups).toBe(1);
    expect(store.createAttempts).toBe(1);
  });
});
