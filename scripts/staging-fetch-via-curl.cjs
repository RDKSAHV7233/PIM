// Shim: replaces fetch() with curl subprocess to work around Railway public domain DNS resolution on local Windows dev machines.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_RESOLVE_IP = process.env.STAGING_RESOLVE_IP || "66.33.22.1";

function headerEntries(input) {
  if (!input) return [];
  if (typeof input.entries === "function") {
    return Array.from(input.entries());
  }
  if (Array.isArray(input)) {
    return input;
  }
  return Object.entries(input);
}

class CurlHeaders {
  constructor(values) {
    this.values = values;
  }
  get(name) {
    return this.values[String(name).toLowerCase()] ?? null;
  }
}

function parseHeaders(raw) {
  const blocks = String(raw).split(/\r?\n\r?\n/).filter(Boolean);
  const last = blocks[blocks.length - 1] || "";
  const lines = last.split(/\r?\n/).filter(Boolean);
  const statusLine = lines.shift() || "HTTP/1.1 000";
  const match = statusLine.match(/^HTTP\/\d+(?:\.\d+)?\s+(\d+)\s*(.*)$/i);
  const status = match ? Number(match[1]) : 0;
  const statusText = match ? match[2] : "";
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    map[key] = value;
  }
  return { status, statusText, headers: new CurlHeaders(map) };
}

global.fetch = async function fetchViaCurl(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : String(input.url));
  const method = String(init.method || "GET").toUpperCase();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-curl-fetch-"));
  const headerFile = path.join(tmpDir, "headers.txt");
  const bodyFile = path.join(tmpDir, "body.txt");
  const args = ["-sS", "-X", method, "-D", headerFile, "-o", bodyFile];
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (url.protocol === "https:" && (url.hostname.endsWith(".up.railway.app") || url.hostname.endsWith("railway.app"))) {
    args.push("--resolve", `${url.hostname}:${port}:${DEFAULT_RESOLVE_IP}`);
  }
  for (const [key, value] of headerEntries(init.headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (init.body !== undefined && init.body !== null) {
    args.push("--data-binary", typeof init.body === "string" ? init.body : String(init.body));
  }
  args.push(url.toString());
  const result = spawnSync("curl.exe", args, { encoding: "utf8" });
  let bodyText = "";
  let headerText = "";
  try {
    bodyText = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, "utf8") : "";
    headerText = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, "utf8") : "";
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `curl failed with status ${result.status}`).trim());
  }
  const parsed = parseHeaders(headerText);
  return {
    ok: parsed.status >= 200 && parsed.status < 300,
    status: parsed.status,
    statusText: parsed.statusText,
    headers: parsed.headers,
    text: async () => bodyText,
    json: async () => bodyText ? JSON.parse(bodyText) : null,
  };
};
