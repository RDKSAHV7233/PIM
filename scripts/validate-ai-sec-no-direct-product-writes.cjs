#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const GOVERNED_AI_DIRS = [
  path.join("apps", "api", "src", "intelligence"),
  path.join("apps", "api", "src", "ai"),
  path.join("apps", "api", "src", "ai-core"),
  path.join("apps", "api", "src", "rejection-intelligence"),
];

const LEGACY_EXCLUDED_PATHS = [
  path.join("apps", "api", "src", "auto-suggestions"),
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs"]);

const GOVERNED_FORBIDDEN_PATTERNS = [
  {
    id: "direct_product_mutation",
    pattern: /\bproduct\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    message: "governed AI code must not call Product persistence mutation methods directly",
  },
  {
    id: "tenant_product_mutation",
    pattern: /\btenant\s*\(\s*\)\s*\.\s*product\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    message: "governed AI code must not mutate tenant-scoped Product records directly",
  },
  {
    id: "transaction_product_mutation",
    pattern: /\btx\s*\.\s*product\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    message: "governed AI code must not mutate Product records through transaction shortcuts",
  },
  {
    id: "catalog_service_import",
    pattern: /from\s+["'][^"']*\/catalog\/catalog\.service["']/,
    message: "governed AI code must not import CatalogService",
  },
  {
    id: "catalog_service_reuse",
    pattern: /\bCatalogService\b/,
    message: "governed AI code must not reuse CatalogService as a mutation shortcut",
  },
  {
    id: "catalog_mutation_method_reuse",
    pattern: /\b\w*catalog\w*Service\.(createProduct|updateProduct|deleteProduct|purgeProduct|decideProductReview|assignProduct|requestChanges)\s*\(/i,
    message: "governed AI code must not call catalog Product mutation methods",
  },
  {
    id: "auto_suggestions_import",
    pattern: /from\s+["'][^"']*auto-suggestions[^"']*["']|["'][^"']*\/auto-suggestions\/[^"']*["']/,
    message: "governed AI code must not import legacy AutoSuggestions modules or endpoints",
  },
  {
    id: "auto_suggestions_reuse",
    pattern: /\bAutoSuggestions(Module|Service)\b/,
    message: "governed AI code must not import or call legacy AutoSuggestions paths",
  },
  {
    id: "write_route_decorator",
    pattern: /@(Post|Patch|Put|Delete)\s*\(/,
    message: "governed AI code must not expose write routes before approved apply design",
  },
  {
    id: "provider_sdk_import",
    pattern: /from\s+["'](openai|@openai\/openai|@anthropic-ai\/sdk|@google\/generative-ai|google-genai|langchain|@langchain\/[^"']+|cohere-ai|mistralai|groq-sdk|replicate|ollama|ai)["']/,
    message: "governed AI code must not import provider/model SDKs in this guard stage",
  },
  {
    id: "provider_client_instantiation",
    pattern: /\b(new\s+OpenAI|new\s+Anthropic|GoogleGenerativeAI|Mistral|CohereClient|Groq|Replicate|ProviderAdapter|ChatCompletion)\b/,
    message: "governed AI code must not instantiate provider/model clients in this guard stage",
  },
  {
    id: "provider_execution_call",
    pattern: /\b(responses\.create|chat\.completions\.create|messages\.create|generateContent\s*\(|model\.invoke\s*\(|llm\.invoke\s*\(|fetch\s*\(|axios\.(post|get|request)\s*\()/,
    message: "governed AI code must not execute provider/model or generic outbound calls in this guard stage",
  },
];

const LEGACY_INFORMATIONAL_PATTERNS = [
  {
    id: "legacy_product_mutation",
    pattern: /\bproduct\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    message: "legacy excluded path contains direct Product mutation and must remain outside AI-001 reuse",
  },
];

function listSourceFiles(rootDir) {
  const files = [];

  function visit(current) {
    if (!fs.existsSync(current)) {
      return;
    }

    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(current)) {
        if (child === "node_modules" || child === "dist" || child === ".next") {
          continue;
        }
        visit(path.join(current, child));
      }
      return;
    }

    if (stat.isFile() && SOURCE_EXTENSIONS.has(path.extname(current))) {
      files.push(current);
    }
  }

  visit(rootDir);
  return files;
}

function lineNumberForIndex(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function scanFile(filePath, patterns, repoRoot) {
  const source = fs.readFileSync(filePath, "utf8");
  const findings = [];

  for (const rule of patterns) {
    const match = rule.pattern.exec(source);
    if (match) {
      findings.push({
        ruleId: rule.id,
        file: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
        line: lineNumberForIndex(source, match.index),
        message: rule.message,
      });
    }
  }

  return findings;
}

function scanDirectories(repoRoot, relativeDirs, patterns) {
  const findings = [];
  const scannedFiles = [];
  const missingDirs = [];

  for (const relativeDir of relativeDirs) {
    const absoluteDir = path.join(repoRoot, relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      missingDirs.push(relativeDir.replace(/\\/g, "/"));
      continue;
    }

    for (const filePath of listSourceFiles(absoluteDir)) {
      scannedFiles.push(path.relative(repoRoot, filePath).replace(/\\/g, "/"));
      findings.push(...scanFile(filePath, patterns, repoRoot));
    }
  }

  return { findings, scannedFiles, missingDirs };
}

function validateNoDirectAiProductWrites(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..");
  const governedDirs = options.governedDirs || GOVERNED_AI_DIRS;
  const legacyExcludedPaths = options.legacyExcludedPaths || LEGACY_EXCLUDED_PATHS;

  const governed = scanDirectories(repoRoot, governedDirs, GOVERNED_FORBIDDEN_PATTERNS);
  const legacy = scanDirectories(repoRoot, legacyExcludedPaths, LEGACY_INFORMATIONAL_PATTERNS);

  return {
    ok: governed.findings.length === 0,
    governed,
    legacy,
  };
}

function formatFindings(findings) {
  return findings.map((finding) => {
    return `${finding.file}:${finding.line} [${finding.ruleId}] ${finding.message}`;
  });
}

function runCli() {
  const result = validateNoDirectAiProductWrites();

  if (!result.ok) {
    console.error("AI-SEC-001 direct AI Product write guard failed:");
    for (const line of formatFindings(result.governed.findings)) {
      console.error(`- ${line}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-SEC-001 direct AI Product write guard passed: ${result.governed.scannedFiles.length} governed AI source files scanned.`,
  );

  if (result.governed.missingDirs.length > 0) {
    console.log(`Governed AI dirs not present yet: ${result.governed.missingDirs.join(", ")}`);
  }

  if (result.legacy.findings.length > 0) {
    console.log("Legacy excluded path observations:");
    for (const line of formatFindings(result.legacy.findings)) {
      console.log(`- ${line}`);
    }
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  GOVERNED_AI_DIRS,
  GOVERNED_FORBIDDEN_PATTERNS,
  LEGACY_EXCLUDED_PATHS,
  LEGACY_INFORMATIONAL_PATTERNS,
  formatFindings,
  validateNoDirectAiProductWrites,
};
