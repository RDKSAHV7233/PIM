#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * G1a (mapping journey review, 2026-10-09): the product page header evaluated channel readiness without an
 * installation id. A mapping published for one connector account is installation-scoped; the API's resolver
 * (connector-mapping.service.ts resolveEffectiveMapping) keeps such a version only when the evaluation names that
 * installation. With no id it matched nothing and added "using_system_default_mapping", so the header card said
 * "Mapping readiness: Warnings - 1 mapping warning remain" although a live account mapping existed. Verified against
 * the live API: without installationId -> warnings ["using_system_default_mapping"], matched []; with it -> warnings
 * [], matched [<published version>].
 * The selection rule is now one shared helper (executed here as code) and every product-page readiness call must name
 * the installation (source contracts).
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "../../../..", "apps", "web", "src");

function loadTsModule(...parts) {
  const ts = require("typescript");
  const Module = require("node:module");
  const file = path.join(SRC, ...parts);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(file),
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod._compile(outputText, file);
  return mod.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const { selectReadinessInstallation } = loadTsModule("lib", "readiness-installation.ts");
  const ready = (connector) => connector.status === "ACTIVE";
  const flipkartA = { id: "a", slug: "flipkart", status: "ACTIVE" };
  const flipkartB = { id: "b", slug: "flipkart", status: "ACTIVE" };
  const shopify = { id: "s", slug: "shopify", status: "ACTIVE" };

  assert(selectReadinessInstallation([shopify, flipkartA], "flipkart", ready)?.id === "a", "picks the installation whose slug matches the channel.");
  assert(selectReadinessInstallation([flipkartA, flipkartB], "flipkart", ready)?.id === "a", "with several accounts the first ready one wins, as before.");
  assert(selectReadinessInstallation([{ ...flipkartA, status: "CREDENTIAL_EXPIRED" }, flipkartB], "flipkart", ready)?.id === "b", "skips an account that is not ready to publish.");
  assert(selectReadinessInstallation([{ ...flipkartA, status: "DISABLED" }], "flipkart", ready) === null, "no ready account gives null (no installation id is sent).");
  assert(selectReadinessInstallation([], "flipkart", ready) === null, "no installed connectors gives null.");
  assert(selectReadinessInstallation([shopify], "flipkart", ready) === null, "a connector for another channel is never selected.");

  // Every product-page readiness call must name the installation.
  const files = [
    path.join(SRC, "app", "products", "[id]", "page.tsx"),
    path.join(SRC, "app", "products", "[id]", "_components", "product-detail-deferred-section.tsx"),
  ];
  let calls = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const pattern = /evaluateConnectorPublishReadiness\(([\s\S]*?)\{ role: actorRole, authHeader \}/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      calls += 1;
      assert(/installationId:\s*readinessInstallation\?\.id/.test(match[1]), `${path.basename(file)}: a readiness call does not pass installationId (G1a).`);
    }
    assert(source.includes('from "@/lib/readiness-installation"') && source.includes("selectReadinessInstallation("), `${path.basename(file)} must use the shared installation selector.`);
  }
  assert(calls === 2, `expected exactly two product-page readiness calls (header and deferred section), found ${calls}.`);

  // The header must choose its installation for the same channel it evaluates.
  const page = fs.readFileSync(files[0], "utf8");
  assert(/selectReadinessInstallation\(\s*installedConnectors,\s*mapMarketplaceChannelToConnectorSlug\(effectiveSelectedChannel\)/.test(page), "the header selects the installation for effectiveSelectedChannel.");

  console.log(JSON.stringify({ status: "ok", validated: ["selector_rule", "every_product_page_readiness_call_names_the_installation", "header_and_deferred_share_the_selector"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Product page readiness installation test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
