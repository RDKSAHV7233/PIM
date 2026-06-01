export const ROLE_PERMISSIONS = [
  { role: "Admin", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "full" },
  { role: "Editor", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "limited" },
  { role: "Reviewer", catalog: "read", channels: "read", ops: "read", quality: "approve", admin: "none" },
  { role: "Viewer", catalog: "read", channels: "read", ops: "read", quality: "read", admin: "none" },
] as const;

export const PILOT_ROLE_ALIGNMENT = [
  {
    persona: "Product admin",
    currentModel: "Admin",
    pilotHandling: "Workspace governance, catalog write, operations write, connector governance, users, API keys, webhooks, and audit logs.",
  },
  {
    persona: "System admin",
    currentModel: "Admin plus internal operator routes outside this customer shell",
    pilotHandling: "Customer shell keeps internal/developer routes hidden; full system-admin split remains future scope.",
  },
  {
    persona: "Editor",
    currentModel: "Editor",
    pilotHandling: "Catalog, import, bulk edit, connector setup, and quality triage write access without machine credential or audit-log administration.",
  },
  {
    persona: "Reviewer",
    currentModel: "Reviewer",
    pilotHandling: "Read-only catalog and operations review with explicit approval/rejection authority.",
  },
  {
    persona: "Vendor",
    currentModel: "Viewer plus delegated access scopes",
    pilotHandling: "Read-only frontend access; vendor-specific scoped write journeys remain future scope.",
  },
  {
    persona: "Category manager",
    currentModel: "Editor or reviewer plus delegated category/brand scopes",
    pilotHandling: "Scope assignments are visible here; dedicated category-manager navigation remains future scope.",
  },
  {
    persona: "API/client operations",
    currentModel: "Admin-issued API key with assigned role",
    pilotHandling: "Machine-principal access is managed from API Keys; scoped machine-principal UX remains future scope.",
  },
] as const;
