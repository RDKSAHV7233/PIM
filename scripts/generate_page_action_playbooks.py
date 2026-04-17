import re
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Set, Tuple

ROOT = Path(r"C:\Users\Om Computers\PIM1")
APP_DIR = ROOT / "apps" / "web" / "src" / "app"
COMP_DIR = ROOT / "apps" / "web" / "src" / "components"
OUT_DIR = ROOT / "docs" / "product" / "user-guide"
PLAYBOOK_DIR = OUT_DIR / "playbooks"

ROUTE_PATTERN = "**/page.tsx"

@dataclass
class Interaction:
    action_names: List[str] = field(default_factory=list)
    button_labels: List[str] = field(default_factory=list)
    label_texts: List[str] = field(default_factory=list)
    input_names: List[str] = field(default_factory=list)
    placeholders: List[str] = field(default_factory=list)
    links: List[str] = field(default_factory=list)
    select_names: List[str] = field(default_factory=list)
    read_helpers: List[str] = field(default_factory=list)
    component_refs: List[str] = field(default_factory=list)


def dedupe(values: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for value in values:
        v = value.strip()
        if not v:
            continue
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def route_from_page(page: Path) -> str:
    rel = page.relative_to(APP_DIR).as_posix()
    route = "/" + rel[:-len("/page.tsx")]
    return "/" if route == "/" else route


def clean_jsx_text(text: str) -> str:
    t = re.sub(r"\{[^}]*\}", "", text)
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def is_human_ui_text(value: str) -> bool:
    if not value:
        return False
    bad_tokens = ["=>", "{", "}", "<", ">", "function", "set", "(", ")"]
    lowered = value.lower()
    if any(token in lowered for token in bad_tokens):
        return False
    if len(value) > 90:
        return False
    if not re.search(r"[a-zA-Z]", value):
        return False
    return True


def extract_from_text(content: str) -> Interaction:
    interaction = Interaction()

    # actions imported from app/actions
    for block in re.findall(r"import\s+\{([^}]*)\}\s+from\s+\"@/app/actions\"", content, flags=re.S):
        items = [i.strip() for i in block.split(",") if i.strip()]
        interaction.action_names.extend(items)

    # api helper imports
    for block in re.findall(r"import\s+\{([^}]*)\}\s+from\s+\"@/lib/api\"", content, flags=re.S):
        items = [i.strip() for i in block.split(",") if i.strip()]
        for i in items:
            i2 = i.replace("type ", "").strip()
            if i2.startswith("get") or i2.startswith("list") or i2.startswith("fetch"):
                interaction.read_helpers.append(i2)

    # forms/actions
    for a in re.findall(r"<form[^>]*action=\{([A-Za-z0-9_]+)\}", content):
        if a != "action":
            interaction.action_names.append(a)

    # input/select names & placeholders
    interaction.input_names.extend(re.findall(r"<input[^>]*name=\"([^\"]+)\"", content))
    interaction.input_names.extend(re.findall(r"<Textarea[^>]*name=\"([^\"]+)\"", content))
    interaction.input_names.extend(re.findall(r"<Input[^>]*name=\"([^\"]+)\"", content))
    interaction.select_names.extend(re.findall(r"<Select[^>]*name=\"([^\"]+)\"", content))
    interaction.placeholders.extend(re.findall(r"placeholder=\"([^\"]+)\"", content))

    # labels
    for lbl in re.findall(r"<label[^>]*>(.*?)</label>", content, flags=re.S):
        txt = clean_jsx_text(lbl)
        if txt:
            interaction.label_texts.append(txt)

    # buttons
    for btn in re.findall(r"<(?:Button|button)[\\s\\S]*?>([\\s\\S]*?)</(?:Button|button)>", content, flags=re.S):
        txt = clean_jsx_text(btn)
        if txt and is_human_ui_text(txt):
            interaction.button_labels.append(txt)

    # links
    interaction.links.extend(re.findall(r"href=\"([^\"]+)\"", content))

    # component refs from @/components
    for comp in re.findall(r"from\s+\"@/components/([^\"]+)\"", content):
        interaction.component_refs.append(comp)

    # dedupe
    interaction.action_names = dedupe(interaction.action_names)
    interaction.button_labels = dedupe(interaction.button_labels)
    interaction.label_texts = dedupe(interaction.label_texts)
    interaction.input_names = dedupe([n for n in interaction.input_names if n and n not in {"actorRole", "hideTestData", "bulkEditPreview"}])
    interaction.placeholders = dedupe(interaction.placeholders)
    interaction.links = dedupe(interaction.links)
    interaction.select_names = dedupe(interaction.select_names)
    interaction.read_helpers = dedupe(interaction.read_helpers)
    interaction.component_refs = dedupe(interaction.component_refs)
    return interaction


def resolve_component_file(component_ref: str) -> Path | None:
    # supports refs like "product/products-tab" or "ui/page-header"
    for ext in (".tsx", ".ts"):
        p = COMP_DIR / f"{component_ref}{ext}"
        if p.exists():
            return p
    return None


def merge(a: Interaction, b: Interaction) -> Interaction:
    out = Interaction(
        action_names=dedupe(a.action_names + b.action_names),
        button_labels=dedupe(a.button_labels + b.button_labels),
        label_texts=dedupe(a.label_texts + b.label_texts),
        input_names=dedupe(a.input_names + b.input_names),
        placeholders=dedupe(a.placeholders + b.placeholders),
        links=dedupe(a.links + b.links),
        select_names=dedupe(a.select_names + b.select_names),
        read_helpers=dedupe(a.read_helpers + b.read_helpers),
        component_refs=dedupe(a.component_refs + b.component_refs),
    )
    return out


def action_title(action: str) -> str:
    base = action
    if base.endswith("Action"):
        base = base[:-6]
    base = re.sub(r"([a-z])([A-Z])", r"\1 \2", base)
    return base.strip().capitalize()


def action_steps(action: str, interaction: Interaction) -> List[str]:
    name = action.lower()
    steps = ["Open this page and review the relevant section for the action."]
    form_labels = interaction.label_texts[:8]
    if form_labels:
        steps.append("Fill the required fields shown on screen: " + ", ".join(f"`{f}`" for f in form_labels) + ".")
    if "delete" in name:
        steps.append("Locate the target record, complete any confirmation checkbox/text, then submit delete.")
    elif "uninstall" in name or "disable" in name:
        steps.append("Locate the installed row and submit disable/uninstall.")
    elif "reconnect" in name:
        steps.append("Locate the installed row and submit reconnect.")
    elif "install" in name:
        steps.append("Pick connector/account details and submit the install form.")
    elif "grant" in name:
        steps.append("Enter principal/action/scope details and submit grant.")
    elif "revoke" in name:
        steps.append("Select an existing policy/permission row and submit revoke.")
    elif "upload" in name:
        steps.append("Select file/media inputs, then submit upload.")
    elif "transition" in name:
        steps.append("Select target status and submit status transition.")
    elif "create" in name:
        steps.append("Complete the creation form and submit.")
    elif "update" in name or "apply" in name:
        steps.append("Review preview/diff (if shown), then submit update/apply.")
    elif "validate" in name:
        steps.append("Run validation and review returned issues before next action.")
    elif "resolve" in name:
        steps.append("Choose the issue/job row to resolve and confirm the action.")
    elif "requeue" in name or "process" in name:
        steps.append("Run the queued job action and monitor job state on jobs/submissions pages.")
    else:
        steps.append("Submit the action and confirm success feedback on screen.")

    steps.append("Verify the page refreshes with updated state (status chip/table row/history).")
    return steps


def make_playbook(route: str, page_path: Path, interaction: Interaction, title: str) -> str:
    lines: List[str] = []
    lines.append("# Page Action Playbook")
    lines.append("")
    lines.append("## Page")
    lines.append(f"- Route: `{route}`")
    lines.append(f"- Source: `{page_path.as_posix()}`")
    lines.append(f"- Title: {title or 'Information not available in Vexa PIM project.'}")
    lines.append("")

    lines.append("## What this page is used for")
    if route == "/channels/mappings":
        lines.append("- Maintain the canonical lifecycle mapping workspace for channel publishing.")
        lines.append("- This is the only editable mapping surface; legacy connector mapping routes redirect here.")
    elif route == "/connectors/[installationId]/mapping":
        lines.append("- Transition-only connector mapping route that redirects to the canonical lifecycle mapping workspace.")
        lines.append("- Do not use this route for editing; use `/channels/mappings` instead.")
    elif route == "/products/[id]":
        lines.append("- Edit product data, fix blockers, review channel readiness, and create export/publish attempts.")
        lines.append("- Mapping edits should be completed in `/channels/mappings`; any template controls here are transition-only helpers.")
    elif interaction.action_names:
        lines.append("- Execute operational workflows and mutations listed below.")
    else:
        lines.append("- Read/monitor data and navigate to downstream workflow pages.")
    lines.append("")

    lines.append("## How to use this page (step-by-step)")
    lines.append("1. Open the route from left navigation or direct URL.")
    if interaction.read_helpers:
        lines.append("2. Wait for data to load from: " + ", ".join(f"`{h}`" for h in interaction.read_helpers[:10]) + ".")
    else:
        lines.append("2. Wait for the page to load and initial tables/cards to render.")

    if interaction.label_texts or interaction.select_names:
        details = []
        if interaction.label_texts:
            details.append("labels: " + ", ".join(f"`{x}`" for x in interaction.label_texts[:10]))
        if interaction.select_names:
            details.append("selects: " + ", ".join(f"`{x}`" for x in interaction.select_names[:10]))
        lines.append("3. Configure filters/form inputs using " + "; ".join(details) + ".")
    else:
        lines.append("3. Use available cards/tables/links to inspect state.")

    if interaction.button_labels:
        lines.append("4. Trigger operations using visible controls such as: " + ", ".join(f"`{x}`" for x in interaction.button_labels[:12]) + ".")
    else:
        lines.append("4. Use row-level actions/links where available.")

    lines.append("5. Confirm success by checking updated status, table rows, and/or history sections.")
    lines.append("")

    if interaction.action_names:
        lines.append("## Action runbooks")
        for action in interaction.action_names:
            lines.append(f"### {action_title(action)} (`{action}`)")
            for idx, step in enumerate(action_steps(action, interaction), start=1):
                lines.append(f"{idx}. {step}")
            lines.append("Expected result:")
            lines.append("- Mutation is accepted and corresponding list/detail status updates on reload.")
            lines.append("Failure handling:")
            lines.append("- If server returns error code/message, correct inputs/permissions and retry.")
            lines.append("")

    lines.append("## Input and control reference")
    lines.append("- Buttons: " + (", ".join(f"`{x}`" for x in interaction.button_labels[:20]) if interaction.button_labels else "Information not available in Vexa PIM project."))
    lines.append("- Visible labels: " + (", ".join(f"`{x}`" for x in interaction.label_texts[:20]) if interaction.label_texts else "Information not available in Vexa PIM project."))
    lines.append("- Field names (technical): " + (", ".join(f"`{x}`" for x in interaction.input_names[:20]) if interaction.input_names else "Information not available in Vexa PIM project."))
    lines.append("- Select names: " + (", ".join(f"`{x}`" for x in interaction.select_names[:20]) if interaction.select_names else "Information not available in Vexa PIM project."))
    lines.append("- Placeholders: " + (", ".join(f"`{x}`" for x in interaction.placeholders[:12]) if interaction.placeholders else "Information not available in Vexa PIM project."))
    lines.append("- Links: " + (", ".join(f"`{x}`" for x in interaction.links[:20]) if interaction.links else "Information not available in Vexa PIM project."))
    lines.append("")

    lines.append("## Related components")
    lines.append("- " + (", ".join(f"`{x}`" for x in interaction.component_refs[:12]) if interaction.component_refs else "Information not available in Vexa PIM project."))
    lines.append("")

    lines.append("## Validation source")
    lines.append("- Derived from route source + first-level component source imports.")
    lines.append("- No behavior is added beyond validated code references.")
    if route in {"/channels/mappings", "/connectors/[installationId]/mapping", "/products/[id]"}:
        lines.append("- Connector workflow note: `/channels/mappings` is the canonical lifecycle mapping route in the current Vexa PIM UX.")
    lines.append("")
    return "\n".join(lines)


def first_heading_or_title(content: str) -> str:
    # use explicit title prop or h1 text if present
    m = re.search(r"title=\"([^\"]+)\"", content)
    if m:
        return m.group(1).strip()
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", content, flags=re.S)
    if h1:
        t = clean_jsx_text(h1.group(1))
        if t:
            return t
    return "Information not available in Vexa PIM project."


def out_name_for_route(route: str) -> str:
    if route == "/":
        return "root_page_playbook.md"
    safe = route.strip("/").replace("/", "__").replace("[", "_").replace("]", "_")
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", safe)
    return f"{safe}_playbook.md"


def build():
    PLAYBOOK_DIR.mkdir(parents=True, exist_ok=True)
    pages = sorted(APP_DIR.glob(ROUTE_PATTERN), key=lambda p: p.as_posix())

    index_lines: List[str] = []
    index_lines.append("# Vexa PIM Page Action Playbook Index")
    index_lines.append("")
    index_lines.append("This index focuses on **how to perform actions** page-by-page.")
    index_lines.append("")
    index_lines.append("| Route | Title | Playbook | Actions Available |")
    index_lines.append("|---|---|---|---|")

    summary_items: List[Tuple[str, str]] = []

    for page in pages:
        route = route_from_page(page)
        page_text = page.read_text(encoding="utf-8", errors="ignore")
        title = first_heading_or_title(page_text)
        page_interaction = extract_from_text(page_text)

        merged = page_interaction
        for comp_ref in page_interaction.component_refs:
            comp_file = resolve_component_file(comp_ref)
            if comp_file is None:
                continue
            comp_text = comp_file.read_text(encoding="utf-8", errors="ignore")
            merged = merge(merged, extract_from_text(comp_text))

        out_name = out_name_for_route(route)
        out_path = PLAYBOOK_DIR / out_name
        out_path.write_text(make_playbook(route, page, merged, title), encoding="utf-8")

        actions_cell = ", ".join(f"`{a}`" for a in merged.action_names[:8]) if merged.action_names else "Read-only / navigation"
        index_lines.append(f"| `{route}` | {title} | [{out_name}](./playbooks/{out_name}) | {actions_cell} |")
        summary_items.append((route, out_name))

    (OUT_DIR / "PAGE_ACTION_PLAYBOOK_INDEX.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")

    # Rewrite functionality guide in procedural format
    func_lines: List[str] = []
    func_lines.append("# Vexa PIM Functionality Runbook (How-To)")
    func_lines.append("")
    func_lines.append("This document explains how to perform core workflows across pages.")
    func_lines.append("")

    func_lines.append("## 1. Log in and open your workspace")
    func_lines.append("1. Open `/login`.")
    func_lines.append("2. Enter `USER ID` and `PASSWORD` fields.")
    func_lines.append("3. Click `Sign in`.")
    func_lines.append("4. If redirected to `/login/locked` or `/login/reset`, complete unlock/reset flow before retry.")
    func_lines.append("")

    func_lines.append("## 2. Create and update products")
    func_lines.append("1. Open `/catalog/products`.")
    func_lines.append("2. Use search/filter controls to locate or triage products.")
    func_lines.append("3. Open product detail `/products/[id]`.")
    func_lines.append("4. In product detail tabs (Overview/Content/Attributes/Variants/Media/Channels/Quality/Activity), edit data and run:")
    func_lines.append("   - `updateProductAction`")
    func_lines.append("   - `validateProductAction`")
    func_lines.append("   - `createVariantAction` (when adding variants)")
    func_lines.append("5. Confirm updated status and quality/readiness feedback on reload.")
    func_lines.append("")

    func_lines.append("## 3. Manage taxonomy (categories/attributes)")
    func_lines.append("1. Open `/catalog/categories` to create/manage categories (`createCategoryAction`).")
    func_lines.append("2. Open `/catalog/attributes` to add category attribute definitions (`createAttributeDefinitionAction`).")
    func_lines.append("3. Re-open affected products and fill newly required fields.")
    func_lines.append("")

    func_lines.append("## 4. Install and manage channel connectors")
    func_lines.append("1. Open `/channels/connectors`.")
    func_lines.append("2. Install a connector (`installConnectorAction`) with account alias/external ref.")
    func_lines.append("3. Use installed rows to `Reconnect` (`reconnectConnectorAction`) or `Disable` (`uninstallConnectorAction`).")
    func_lines.append("4. For disabled installations, admin can permanently delete (`deleteConnectorInstallationAction`).")
    func_lines.append("5. Open `/channels/connectors/[installationId]` for connector details.")
    func_lines.append("6. If mapping changes are needed, continue to `/channels/mappings` (the canonical lifecycle mapping workspace).")
    func_lines.append("")

    func_lines.append("## 5. Build and maintain channel mappings")
    func_lines.append("1. Open `/channels/mappings`.")
    func_lines.append("2. Create a mapping version (`createConnectorMappingVersionAction`).")
    func_lines.append("3. Validate the version (`validateConnectorMappingVersionAction`).")
    func_lines.append("4. Publish the version (`publishConnectorMappingVersionAction`) after step-up re-authentication.")
    func_lines.append("5. Archive or rollback versions when required (`archiveConnectorMappingVersionAction`, `rollbackConnectorMappingVersionAction`).")
    func_lines.append("6. Treat `/connectors/[installationId]/mapping` as a transition-only redirect, not a separate editor.")
    func_lines.append("")

    func_lines.append("## 6. Run imports and bulk edits")
    func_lines.append("1. Open `/operations/imports` to monitor import jobs and rows.")
    func_lines.append("2. Open `/operations/bulk-edit`.")
    func_lines.append("3. Set scope filters (category/status/brand/product IDs).")
    func_lines.append("4. Enter JSON updates and click preview.")
    func_lines.append("5. Apply changes via `applyBulkEditAction` from preview panel.")
    func_lines.append("6. Validate operation in history table.")
    func_lines.append("")

    func_lines.append("## 7. Manage quality and approvals")
    func_lines.append("1. Open `/quality/issues` for issue inbox.")
    func_lines.append("2. Resolve warnings in bulk using `resolveIssueInboxWarningsAction`.")
    func_lines.append("3. Open `/quality/approvals` to transition status (`transitionProductStatusAction`).")
    func_lines.append("4. Use `/quality/validation`, `/quality/completeness`, and `/rejection` for readiness and rejection insight loops.")
    func_lines.append("")

    func_lines.append("## 8. Run channel submission/export jobs")
    func_lines.append("1. From product detail, create export job (`createExportJobAction`).")
    func_lines.append("2. Process queued job (`processExportJobAction`).")
    func_lines.append("3. Requeue failed job (`requeueExportJobAction`) when needed.")
    func_lines.append("4. Use `/channels/mappings` for mapping corrections if publish readiness blocks the product.")
    func_lines.append("5. Track outcomes in `/channels/submissions` and `/operations/jobs`.")
    func_lines.append("")

    func_lines.append("## 9. Admin governance workflows")
    func_lines.append("1. Open `/admin/plan` to set plan tier (`setPlanTierAction`).")
    func_lines.append("2. Open `/admin/connectors` to grant/revoke connector permissions (`grantConnectorPermissionAction`, `revokeConnectorPermissionAction`).")
    func_lines.append("3. Use `/admin/users`, `/admin/audit`, `/admin/workspace`, `/admin/privacy` for governance views.")
    func_lines.append("")

    func_lines.append("## 10. Media workflows")
    func_lines.append("1. Open `/media` or `/catalog/media`.")
    func_lines.append("2. Upload assets (`uploadMediaAssetAction`).")
    func_lines.append("3. Associate in bulk when needed (`bulkAssociateMediaCsvAction`).")
    func_lines.append("4. Validate media compliance via `getMediaAssetValidation` outputs.")
    func_lines.append("")

    func_lines.append("## Full page playbooks")
    for route, out_name in summary_items:
        func_lines.append(f"- `{route}` -> [playbook](./playbooks/{out_name})")

    (OUT_DIR / "FUNCTIONALITY_WISE_GUIDE.md").write_text("\n".join(func_lines) + "\n", encoding="utf-8")

    # update README
    readme = []
    readme.append("# Vexa PIM User Guide Bundle")
    readme.append("")
    readme.append("This folder now includes procedural, action-oriented documentation.")
    readme.append("")
    readme.append("## Primary documents")
    readme.append("- `PAGE_ACTION_PLAYBOOK_INDEX.md` (page-by-page how-to index)")
    readme.append("- `playbooks/*.md` (one step-by-step playbook per route)")
    readme.append("- `FUNCTIONALITY_WISE_GUIDE.md` (workflow runbook by module)")
    readme.append("- `PAGE_GUIDE_INDEX.md` and `pages/*.md` (reference inventory, kept for traceability; connector-critical routes are manually aligned to the current lifecycle mapping flow)")
    readme.append("")
    readme.append("## Coverage")
    readme.append(f"- Route playbooks: {len(summary_items)}")
    readme.append("- Source scope: `apps/web/src/app/**/page.tsx` + first-level imported components")
    readme.append("")
    readme.append("## Validation policy")
    readme.append("- Uses only validated code references from current Vexa PIM source.")
    readme.append("- If control labels are dynamic/not explicit, playbooks keep wording generic and reference action IDs.")

    (OUT_DIR / "README.md").write_text("\n".join(readme) + "\n", encoding="utf-8")

    print(f"Generated playbooks: {len(summary_items)}")


if __name__ == "__main__":
    build()
