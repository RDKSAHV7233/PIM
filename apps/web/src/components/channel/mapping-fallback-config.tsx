import { createConnectorMappingVersionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
export function MappingFallbackConfigCard({
  canWrite,
  connectorSlug,
  definitionId,
  definitionVersion,
  redirectTo,
  selectedCategoryId,
  selectedTargetCategory,
  fallbackPolicyDefault,
  fallbackTitle,
}: {
  canWrite: boolean;
  connectorSlug: string;
  definitionId: string;
  definitionVersion: string;
  redirectTo: string;
  selectedCategoryId: string;
  selectedTargetCategory: string;
  fallbackPolicyDefault: string;
  fallbackTitle: string;
}) {
  if (!selectedCategoryId) {
    return null;
  }

  return (
    <Card id="mapping-fallback">
      <CardTitle>{fallbackTitle}</CardTitle>
      <p className="mt-1 text-xs text-slate-500">
        Optional: if this category isn&apos;t available at publish time, route to a fallback category instead.
        When enabled, acknowledgement is required in version history before publish can clear.
      </p>
      {canWrite ? (
        <form action={createConnectorMappingVersionAction} className="mt-3 grid gap-3">
          <input type="hidden" name="connectorSlug" value={connectorSlug} />
          <input type="hidden" name="connectorDefinitionId" value={definitionId} />
          <input type="hidden" name="connectorDefinitionVersion" value={definitionVersion} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input type="hidden" name="categoryScope" value={selectedCategoryId} />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-enabled-scope">
                Allow fallback mapping
              </label>
              <Select id="fallback-enabled-scope" name="fallbackEnabled" defaultValue="true">
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-ack-required-scope">
                Fallback confirmation
              </label>
              <Select id="fallback-ack-required-scope" name="fallbackAckRequired" defaultValue="true">
                <option value="true">Required</option>
                <option value="false">Not required</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-default-category-scope">
                Default fallback category
              </label>
              <Input
                id="fallback-default-category-scope"
                name="fallbackDefaultCategory"
                placeholder="Optional fallback category id"
              />
              <p className="text-xs text-slate-400">Must differ from the publish category above.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-warning-tag-scope">
                Fallback label
              </label>
              <Input id="fallback-warning-tag-scope" name="fallbackWarningTag" defaultValue="fallback_category_mapping" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-ack-message-scope">
                Confirmation message
              </label>
              <Textarea
                id="fallback-ack-message-scope"
                name="fallbackAckMessage"
                rows={2}
                defaultValue="Fallback category will be used for publish if no explicit mapping exists."
              />
            </div>
            <div className="md:col-span-2">
              <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced: override fallback behavior (JSON)</summary>
                <div className="mt-3 space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="fallback-policy-scope">
                    Override fallback behavior (JSON)
                  </label>
                  <Textarea id="fallback-policy-scope" name="fallbackPolicy" rows={4} placeholder={fallbackPolicyDefault} />
                </div>
              </details>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" size="sm">Save fallback config</Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Your role is read-only for fallback configuration.</p>
      )}
    </Card>
  );
}
