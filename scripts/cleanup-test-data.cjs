// Cleanup script for orphaned test data
const h = require("../apps/web/test/e2e/helpers/vexa-pim.cjs");
(async () => {
  const adminToken = await h.apiLogin("admin");
  // Clean up orphaned pw-user-* users
  const users = await h.apiRequest("GET", "/admin/workspace/users", adminToken);
  const testUsers = users.filter(u =>
    u.userId.startsWith("pw-user-") ||
    u.userId.startsWith("playwright-test-direct") ||
    u.userId.startsWith("pw-api-test-") ||
    u.userId.startsWith("pw-test-timing-")
  );
  console.log("Cleaning up", testUsers.length, "test users");
  for (const u of testUsers) {
    try {
      await h.apiRequest("DELETE", "/admin/workspace/users/" + encodeURIComponent(u.userId), adminToken);
      console.log("Deleted user:", u.userId);
    } catch(e) { console.log("Failed to delete", u.userId, ":", e.message); }
  }
  // Clean up orphaned e2e-webhook-* webhooks
  const webhooks = await h.apiRequest("GET", "/admin/webhooks", adminToken);
  const testWebhooks = webhooks.filter(w => w.name && w.name.startsWith("e2e-webhook-"));
  console.log("Cleaning up", testWebhooks.length, "test webhooks");
  for (const w of testWebhooks) {
    try {
      await h.apiRequest("DELETE", "/admin/webhooks/" + encodeURIComponent(w.id), adminToken);
      console.log("Deleted webhook:", w.name);
    } catch(e) { console.log("Failed to delete webhook", w.name, ":", e.message); }
  }
  console.log("Cleanup done");
})().catch(e => console.error("ERR:", e.message));
