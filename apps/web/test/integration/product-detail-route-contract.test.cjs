#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const PRODUCT_SHARED = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "product-detail-shared.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PRODUCT_PAGE, "utf8");
  const sharedSource = fs.readFileSync(PRODUCT_SHARED, "utf8");

  assert(
    sharedSource.includes('return matched?.key ?? "overview";') &&
      sharedSource.includes("READINESS_CHANNELS[0] ?? DEFAULT_MARKETPLACE_CHANNEL") &&
      sharedSource.includes("return trimmed || undefined;"),
    "Product detail shared helpers must normalize unknown tabs, channels, and template ids into safe defaults.",
  );
  assert(
    pageSource.includes('const activeTab = normalizeDetailTab(query.tab);') &&
      pageSource.includes('const selectedChannel = normalizeChannel(query.channel);') &&
      pageSource.includes('const selectedTemplateId = normalizeTemplateId(query.templateId);') &&
      pageSource.includes('const statusAt = String(query.statusAt ?? "").trim();') &&
      pageSource.includes('const showChannelDiagnostics = activeTab === "channels" && String(query.focus ?? "").trim() === "simulator";'),
    "Product detail route must normalize tab, channel, template, status-refresh, and diagnostics focus state before building the page model.",
  );
  assert(
    pageSource.includes('return /^\\/(?!\\/)/.test(v) ? v : "";') &&
      pageSource.includes(': "";'),
    "Product detail route must only preserve returnTo values that resolve to safe in-app paths.",
  );
  assert(
    pageSource.includes('String(query.planLimit ?? "").trim() === "1"') &&
      pageSource.includes('if (["planLimit", "planResource", "planLimitValue", "planCurrent", "planUpgrade", "planContact"].includes(key)) return;') &&
      pageSource.includes('return encoded ? `/products/${encodeURIComponent(id)}?${encoded}` : `/products/${encodeURIComponent(id)}`;'),
    "Product detail route must only open the plan-limit modal when the full plan contract is present and must strip modal query state from the dismiss link.",
  );
  assert(
    pageSource.includes("const variantsPromise = getProductVariants(") &&
      pageSource.includes("const channelsPromise = getMarketplaceChannels(") &&
      pageSource.includes("const installedConnectorsPromise = getInstalledConnectors(") &&
      pageSource.includes("const exportJobsPromise = getMarketplaceExportJobs(") &&
      pageSource.includes("product = await getProduct("),
    "Product detail route must pre-start secondary fetches while still awaiting the primary product record.",
  );
  assert(
    pageSource.includes('redirect(buildLoginRedirect(`/products/${encodeURIComponent(id)}`, error));') &&
      pageSource.includes("notFound();"),
    "Product detail route must redirect auth failures through the centralized login helper and treat other product fetch failures as notFound.",
  );
  assert(
    pageSource.includes('params.set("tab", tab);') &&
      pageSource.includes('if (selectedChannel) params.set("channel", selectedChannel);') &&
      pageSource.includes('if (selectedTemplateId) params.set("templateId", selectedTemplateId);') &&
      pageSource.includes('if (returnTo) params.set("returnTo", returnTo);'),
    "Product detail route must preserve normalized channel, template, and return context while switching tabs.",
  );
  assert(
    pageSource.includes("const channelDiagnosticsHref = (channel: string): string => {") &&
      pageSource.includes('params.set("focus", "simulator");') &&
      pageSource.includes('const readinessChannelLinks = Object.fromEntries(') &&
      pageSource.includes('selectedTemplateId={selectedTemplateId}') &&
      pageSource.includes('channelLinks={readinessChannelLinks}') &&
      pageSource.includes('refreshSignal={statusAt}') &&
      pageSource.includes('activeTab === "overview" || activeTab === "channels" || activeTab === "quality" ? <ProductReadinessSummaryBar productId={id} role={actorRole} selectedTemplateId={selectedTemplateId} channelLinks={readinessChannelLinks} refreshSignal={statusAt} summary={{ currentChannelLabel: selectedChannelConfig?.displayName ?? selectedChannel') &&
      pageSource.includes('{ title: "Product readiness", href: tabHref("quality"), ...productReadiness }') &&
      pageSource.includes('{ title: "Last export attempt", href: tabHref("channels"), ...lastExportAttempt }'),
    "Product detail route must build channel-specific diagnostics links and pass template-aware, action-refresh-aware inputs into the summary bar.",
  );
  assert(
    pageSource.includes('label: "Unavailable"') &&
      pageSource.includes("Latest export activity could not be loaded right now.") &&
      pageSource.includes("Connector account status could not be loaded right now.") &&
      pageSource.includes("Publish readiness could not be loaded right now."),
    "Product detail route must surface unavailable states when supporting channel, export, or connector reads fail instead of defaulting to false healthy cards.",
  );
  assert(
    pageSource.includes("returnTo ? <Link href={returnTo}") &&
      pageSource.includes('const showSaveAction = canWrite && (activeTab === "content" || activeTab === "attributes");') &&
      pageSource.includes('const showValidateAction = canWrite && activeTab === "quality";') &&
      pageSource.includes('{showSaveAction ? <button type="submit" form="product-edit-form"') &&
      pageSource.includes('{showValidateAction ? <button type="submit" form="product-validate-form"') &&
      pageSource.includes('{canWrite ? <Link href={tabHref(\"channels\")}'),
    "Product detail header actions must preserve the inbox return path and only expose save and validation controls on tabs that mount their backing workflows.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_detail_route_normalizes_query_state",
          "product_detail_route_sanitizes_return_paths_and_plan_limit_modal_state",
          "product_detail_route_redirects_auth_failures_and_not_founds_other_fetch_errors",
          "product_detail_route_preserves_context_across_tab_links",
          "product_detail_route_limits_readiness_summary_and_write_actions_to_supported_contexts",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Product detail route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
