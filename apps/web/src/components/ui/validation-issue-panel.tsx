"use client";

import { translateError } from "@/lib/errors";

type ValidationIssueRow = {
  id: string;
  severity: string;
  ruleCode: string;
  fieldPath: string | null;
  message: string;
};

interface ValidationIssuePanelProps {
  issues: ValidationIssueRow[];
}

function resolveFieldSelector(fieldPath: string): string {
  if (fieldPath.startsWith("attributes.")) {
    return "attributes";
  }
  return fieldPath;
}

function clearExistingRemediation() {
  document
    .querySelectorAll("[data-inline-remediation='true']")
    .forEach((element) => element.remove());
}

function clearExistingHighlights() {
  document
    .querySelectorAll(".field-highlight")
    .forEach((element) => element.classList.remove("field-highlight"));
}

function focusField(fieldPath: string, remediation: string) {
  const selector = resolveFieldSelector(fieldPath);
  const target = document.querySelector<HTMLElement>(`[data-field="${selector}"]`);
  if (!target) {
    return;
  }

  clearExistingRemediation();
  clearExistingHighlights();

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("field-highlight");
  target.focus();
  window.setTimeout(() => {
    target.classList.remove("field-highlight");
  }, 2000);

  const remediationNode = document.createElement("p");
  remediationNode.dataset.inlineRemediation = "true";
  remediationNode.className = "mt-1 text-xs text-amber-700";
  remediationNode.textContent = remediation;
  target.insertAdjacentElement("afterend", remediationNode);
}

export function ValidationIssuePanel({ issues }: ValidationIssuePanelProps) {
  return (
    <div className="w-full max-w-full">
      {/* Desktop table — hidden on small screens */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Severity</th>
              <th className="py-2">Issue</th>
              <th className="py-2">Field</th>
              <th className="py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              const translated = translateError(issue.ruleCode);
              const remediation = translated.action ?? "Update the field and save again.";
              return (
                <tr key={issue.id} className="border-t border-border">
                  <td className="py-2 capitalize">{issue.severity}</td>
                  <td className="py-2">{translated.title}</td>
                  <td className="py-2">{issue.fieldPath ?? "-"}</td>
                  <td className="py-2">
                    {issue.fieldPath ? (
                      <button
                        type="button"
                        className="text-left text-accent hover:underline"
                        onClick={() => focusField(issue.fieldPath ?? "", remediation)}
                      >
                        {issue.message}
                      </button>
                    ) : (
                      issue.message
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked list — shown below sm breakpoint */}
      <div className="flex flex-col space-y-2 sm:hidden">
        {issues.map((issue) => {
          const translated = translateError(issue.ruleCode);
          const remediation = translated.action ?? "Update the field and save again.";
          return (
            <div key={`mobile-${issue.id}`} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium capitalize">{issue.severity}</span>
                <span className="text-slate-600">{translated.title}</span>
              </div>
              {issue.fieldPath ? (
                <p className="mt-1 text-xs text-slate-500">Field: {issue.fieldPath}</p>
              ) : null}
              <div className="mt-1 text-slate-700">
                {issue.fieldPath ? (
                  <button
                    type="button"
                    className="text-left text-accent hover:underline"
                    onClick={() => focusField(issue.fieldPath ?? "", remediation)}
                  >
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
