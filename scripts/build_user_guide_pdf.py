import html
import re
from pathlib import Path

ROOT = Path(r"C:\Users\Om Computers\PIM1")
UG = ROOT / "docs" / "product" / "user-guide"
PAGES = UG / "pages"
PLAYBOOKS = UG / "playbooks"
OUT_HTML = UG / "TEJ_PIM_User_Guide_Navigation.html"

files = [
    UG / "README.md",
    UG / "FUNCTIONALITY_WISE_GUIDE.md",
    UG / "PAGE_ACTION_PLAYBOOK_INDEX.md",
]
files += sorted(PLAYBOOKS.glob("*.md"), key=lambda p: p.name.lower())
files += [UG / "PAGE_GUIDE_INDEX.md"]
files += sorted(PAGES.glob("*.md"), key=lambda p: p.name.lower())


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return s or "section"


def render_inline(text: str) -> str:
    esc = html.escape(text)
    esc = re.sub(r"`([^`]+)`", lambda m: f"<code>{html.escape(m.group(1))}</code>", esc)
    esc = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", esc)
    esc = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', esc)
    return esc


def parse_table(lines, i):
    header = lines[i]
    if i + 1 >= len(lines):
        return None, i
    sep = lines[i + 1]
    if not ("|" in header and "|" in sep and re.search(r"^\s*\|?\s*:?[-]+", sep)):
        return None, i
    rows = []
    j = i + 2
    while j < len(lines) and "|" in lines[j] and lines[j].strip():
        rows.append(lines[j])
        j += 1

    def split_row(row):
        parts = [c.strip() for c in row.strip().strip("|").split("|")]
        return parts

    hcells = split_row(header)
    out = ["<table>", "<thead><tr>"]
    out += [f"<th>{render_inline(c)}</th>" for c in hcells]
    out.append("</tr></thead>")
    out.append("<tbody>")
    for r in rows:
        out.append("<tr>")
        out += [f"<td>{render_inline(c)}</td>" for c in split_row(r)]
        out.append("</tr>")
    out.append("</tbody></table>")
    return "\n".join(out), j - 1


def md_to_html(md: str, prefix: str):
    lines = md.splitlines()
    out = []
    toc = []
    i = 0
    in_code = False
    code_buf = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if not in_code:
                in_code = True
                code_buf = []
            else:
                out.append("<pre><code>" + html.escape("\n".join(code_buf)) + "</code></pre>")
                in_code = False
                code_buf = []
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        if not stripped:
            out.append("")
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            lvl = len(m.group(1))
            title = m.group(2).strip()
            anchor = f"{prefix}-{slugify(title)}"
            out.append(f"<h{lvl} id=\"{anchor}\">{render_inline(title)}</h{lvl}>")
            toc.append((lvl, title, anchor))
            i += 1
            continue

        if stripped == "---":
            out.append("<hr />")
            i += 1
            continue

        table_html, ni = parse_table(lines, i)
        if table_html:
            out.append(table_html)
            i = ni + 1
            continue

        if re.match(r"^\s*[-*]\s+", line):
            out.append("<ul>")
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                item = re.sub(r"^\s*[-*]\s+", "", lines[i])
                out.append(f"<li>{render_inline(item)}</li>")
                i += 1
            out.append("</ul>")
            continue

        if re.match(r"^\s*\d+\.\s+", line):
            out.append("<ol>")
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                item = re.sub(r"^\s*\d+\.\s+", "", lines[i])
                out.append(f"<li>{render_inline(item)}</li>")
                i += 1
            out.append("</ol>")
            continue

        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,6})\s+", lines[i]) and not re.match(r"^\s*[-*]\s+", lines[i]) and not re.match(r"^\s*\d+\.\s+", lines[i]) and lines[i].strip() != "---" and not lines[i].strip().startswith("```"):
            if "|" in lines[i] and i + 1 < len(lines) and "|" in lines[i + 1] and re.search(r"^\s*\|?\s*:?[-]+", lines[i + 1]):
                break
            para.append(lines[i])
            i += 1
        out.append(f"<p>{render_inline(' '.join([p.strip() for p in para]))}</p>")

    return "\n".join(out), toc

sections_html = []
master_toc = []

for f in files:
    rel = f.relative_to(UG)
    title = rel.as_posix()
    md = f.read_text(encoding="utf-8", errors="ignore")
    prefix = slugify(title)
    body, toc = md_to_html(md, prefix)
    section_anchor = f"file-{prefix}"
    master_toc.append((1, title, section_anchor))
    for lvl, t, a in toc:
        master_toc.append((min(6, lvl + 1), t, a))
    sections_html.append(f"<section id=\"{section_anchor}\"><h1>{html.escape(title)}</h1>{body}</section>")

nav_items = []
for lvl, t, a in master_toc:
    indent = (lvl - 1) * 14
    cls = "file-link" if lvl == 1 else "sub-link"
    nav_items.append(f'<a class="{cls}" href="#{a}" style="padding-left:{indent + 8}px">{html.escape(t)}</a>')

html_doc = f"""<!doctype html>
<html>
<head>
<meta charset=\"utf-8\" />
<title>TEJ PIM User Guide (Action Navigation)</title>
<style>
:root {{ --bg:#f8fafc; --surface:#ffffff; --border:#dbe3ef; --text:#0f172a; --muted:#475569; --link:#0f4aa3; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:Segoe UI, Arial, sans-serif; color:var(--text); background:var(--bg); }}
.layout {{ display:grid; grid-template-columns:320px minmax(0,1fr); min-height:100vh; }}
aside {{ position:sticky; top:0; height:100vh; overflow:auto; border-right:1px solid var(--border); background:var(--surface); }}
main {{ padding:24px 30px; }}
.toc-title {{ font-size:15px; font-weight:700; padding:14px 12px 8px; border-bottom:1px solid var(--border); }}
nav {{ padding:8px 0 18px; display:flex; flex-direction:column; gap:2px; }}
nav a {{ text-decoration:none; color:var(--muted); font-size:12px; line-height:1.35; padding:4px 8px; }}
nav a.file-link {{ color:var(--text); font-weight:600; margin-top:6px; }}
nav a:hover {{ background:#eef4ff; color:var(--link); }}
section {{ background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:18px 20px; margin-bottom:18px; }}
h1 {{ font-size:22px; margin:0 0 12px; }}
h2 {{ font-size:18px; margin:18px 0 8px; }}
h3 {{ font-size:15px; margin:14px 0 6px; }}
p, li {{ font-size:13px; line-height:1.55; }}
code {{ background:#f1f5f9; border:1px solid var(--border); padding:1px 4px; border-radius:4px; font-family:Consolas, monospace; font-size:12px; }}
pre {{ background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; overflow:auto; font-size:12px; }}
hr {{ border:none; border-top:1px solid var(--border); margin:14px 0; }}
table {{ width:100%; border-collapse:collapse; margin:10px 0; font-size:12px; }}
th, td {{ border:1px solid var(--border); padding:6px 8px; vertical-align:top; }}
th {{ background:#f1f5f9; text-align:left; }}
@media print {{
  .layout {{ grid-template-columns:1fr; }}
  aside {{ position:static; height:auto; border-right:none; border-bottom:1px solid var(--border); }}
  main {{ padding:14px; }}
  section {{ page-break-inside:avoid; }}
}}
</style>
</head>
<body>
<div class=\"layout\">
  <aside>
    <div class=\"toc-title\">TEJ PIM User Guide Navigation</div>
    <nav>{''.join(nav_items)}</nav>
  </aside>
  <main>
    {''.join(sections_html)}
  </main>
</div>
</body>
</html>
"""

OUT_HTML.write_text(html_doc, encoding="utf-8")
print(f"HTML written: {OUT_HTML}")
