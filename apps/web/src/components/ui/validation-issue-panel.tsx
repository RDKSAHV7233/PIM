"use client";

import { DataGrid, type Column } from "@/components/ui/data-grid";
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
  const columns: Column<ValidationIssueRow>[] = [
    {
      key: "severity",
      header: "Severity",
      render: (issue) => (
        <div className="space-y-1">
          <span className="capitalize">{issue.severity}</span>
          <span className="block text-xs text-slate-500 md:hidden">Tap the message to jump to the affected field.</span>
        </div>
      ),
    },
    {
      key: "ruleCode",
      header: "Issue",
      render: (issue) => translateError(issue.ruleCode).title,
    },
    {
      key: "fieldPath",
      header: "Field",
      mobileHide: true,
      render: (issue) => issue.fieldPath ?? "-",
    },
    {
      key: "message",
      header: "Message",
      render: (issue) => {
        const translated = translateError(issue.ruleCode);
        const remediation = translated.action ?? "Update the field and save again.";
        return issue.fieldPath ? (
          <button
            type="button"
            className="text-left text-accent hover:underline"
            onClick={() => focusField(issue.fieldPath ?? "", remediation)}
          >
            {issue.fieldPath ? `${issue.fieldPath}: ${issue.message}` : issue.message}
          </button>
        ) : (
          issue.message
        );
      },
    },
  ];

  return (
    <DataGrid
      columns={columns}
      rows={issues}
      getRowKey={(issue) => issue.id}
      caption="Validation issues"
      rowClassName="align-top"
    />
  );
}
