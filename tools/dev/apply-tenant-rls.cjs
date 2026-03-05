#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += "/";
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      current += ch;
      if (ch === "$") {
        const maybeTag = sql.slice(i - dollarTag.length + 1, i + 1);
        if (maybeTag === dollarTag) {
          dollarTag = null;
        }
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "-" && next === "-") {
        current += "--";
        i += 1;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        current += "/*";
        i += 1;
        inBlockComment = true;
        continue;
      }
      if (ch === "$") {
        const rest = sql.slice(i);
        const match = rest.match(/^\$[A-Za-z0-9_]*\$/);
        if (match) {
          dollarTag = match[0];
          current += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      }
    }

    if (ch === "'" && !inDoubleQuote) {
      current += ch;
      if (inSingleQuote && next === "'") {
        current += "'";
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      current += ch;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

async function run() {
  const migrationPath = path.join(
    process.cwd(),
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260301001000_tenant_rls_baseline",
    "migration.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    throw new Error("No SQL statements found in tenant migration.");
  }

  const prisma = new PrismaClient();
  let applied = 0;
  try {
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
      applied += 1;
    }
    console.log(
      JSON.stringify(
        {
          migration: "20260301001000_tenant_rls_baseline",
          statements: statements.length,
          applied,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
