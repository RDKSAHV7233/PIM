#!/usr/bin/env node
/* eslint-disable no-console */
// Unit tests for the pure helpers of scripts/p1-woo-credential-ownership-proof.cjs. The proof itself needs
// Docker, a database and the built API and is run by hand; these tests pin the pieces that decide whether
// it can leak a secret or miss a change.

const assert = require("node:assert/strict");
const { redactSecret, describeCallbackBody, fingerprintRows, findLeaks, findWcAuthCode, expandSecretVariants } = require("./p1-woo-credential-ownership-proof.cjs");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("redactSecret shows only the kind prefix and the length", () => {
  assert.equal(redactSecret("ck_0123456789abcdef"), "ck_***(len 19)");
  assert.equal(redactSecret("cs_abc"), "cs_***(len 6)");
  assert.equal(redactSecret("plainvalue"), "***(len 10)");
  assert.equal(redactSecret(""), "<empty>");
  assert.equal(redactSecret(undefined), "<empty>");
  assert.ok(!redactSecret("ck_0123456789abcdef").includes("0123"));
});

test("describeCallbackBody keeps the key names and types but never the credential values", () => {
  const body = JSON.stringify({ key_id: 7, user_id: "tenant-a", consumer_key: "ck_REALSECRETVALUE", consumer_secret: "cs_REALSECRETVALUE", key_permissions: "read_write" });
  const described = describeCallbackBody(body);
  assert.equal(described.parsedAs, "json");
  assert.deepEqual(described.keys, ["consumer_key", "consumer_secret", "key_id", "key_permissions", "user_id"]);
  assert.equal(described.shape.key_id, "number");
  assert.equal(described.shape.consumer_key, "ck_***(len 18)");
  assert.ok(!JSON.stringify(described).includes("REALSECRETVALUE"));
});

test("describeCallbackBody reports a non-JSON body instead of throwing", () => {
  assert.deepEqual(describeCallbackBody("consumer_key=a&consumer_secret=b"), { parsedAs: "not-json", keys: [] });
});

test("fingerprintRows is order independent and changes when any row changes", () => {
  const a = { id: "i1:consumer_key", tenant_key: "t1", installation_id: "i1", credential_type: "consumer_key", encrypted_hash: "h1", updated_at: "2026-01-01" };
  const b = { id: "i1:consumer_secret", tenant_key: "t1", installation_id: "i1", credential_type: "consumer_secret", encrypted_hash: "h2", updated_at: "2026-01-01" };
  const base = fingerprintRows([a, b]);
  assert.equal(base, fingerprintRows([b, a]));
  assert.notEqual(base, fingerprintRows([{ ...a, encrypted_hash: "other" }, b]), "a changed value");
  assert.notEqual(base, fingerprintRows([{ ...a, tenant_key: "t2" }, b]), "a changed owner");
  assert.notEqual(base, fingerprintRows([{ ...a, updated_at: "2026-01-02" }, b]), "a touched row");
  assert.notEqual(base, fingerprintRows([a]), "a removed row");
  assert.notEqual(base, fingerprintRows([a, b, { ...b, id: "i2:consumer_secret" }]), "an added row");
});

test("findLeaks finds a registered secret anywhere in the text and ignores short or empty values", () => {
  const secrets = new Set(["ck_supersecretvalue", "tok", ""]);
  assert.deepEqual(findLeaks("nothing here", secrets), []);
  assert.equal(findLeaks("log line with ck_supersecretvalue inside", secrets).length, 1);
  assert.deepEqual(findLeaks("the word tok appears", secrets), [], "values under 6 characters are not matched");
  const reported = findLeaks("ck_supersecretvalue", secrets).join(" ");
  assert.ok(!reported.includes("supersecretvalue"), "a leak is reported redacted");
});

test("expandSecretVariants covers the encodings the script could emit a secret in", () => {
  const variants = expandSecretVariants("p@ss/word+1");
  for (const v of [
    "p@ss/word+1",
    Buffer.from("p@ss/word+1").toString("base64"),
    Buffer.from("p@ss/word+1").toString("base64url"),
    Buffer.from("p@ss/word+1").toString("hex"),
    encodeURIComponent("p@ss/word+1"),
  ]) assert.ok(variants.includes(v), `missing variant ${v}`);
  assert.deepEqual(expandSecretVariants(""), []);
  assert.deepEqual(expandSecretVariants(undefined), []);
});

test("a secret emitted base64- or url-encoded is still found by the leak scan", () => {
  const secret = "ck_supersecretvalue_for_scan";
  const set = new Set(expandSecretVariants(secret));
  assert.ok(findLeaks(`header ${Buffer.from(secret).toString("base64")}`, set).length >= 1);
  assert.equal(findLeaks(`?k=${encodeURIComponent(secret)}`, set).length, 1);
  assert.equal(findLeaks(`hex ${Buffer.from(secret).toString("hex")}`, set).length, 1);
});

test("findWcAuthCode flags code that builds an app-auth URL but not comments", () => {
  const files = [
    { file: "a.ts", text: "// the WooCommerce /wc-auth/v1/authorize callback returns\n/* wc-auth */\n * wc-auth in a block comment\nconst x = 1;" },
    { file: "b.ts", text: "const url = `${site}/wc-auth/v1/authorize?${qs}`;" },
  ];
  assert.deepEqual(findWcAuthCode(files), ["b.ts:1"]);
  assert.deepEqual(findWcAuthCode([files[0]]), []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
}
console.log(`p1-woo-credential-ownership-proof helpers: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
