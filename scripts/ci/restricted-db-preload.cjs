"use strict";

/**
 * SEC-DB-RLS-001 restricted-role lane: switches ONLY the API process to the restricted database role.
 *
 * Loaded through NODE_OPTIONS=--require. Every integration test is a node process that seeds and inspects the database with the
 * admin identity (so no test needs rewriting) and then spawns apps/api/dist/main.js. Because NODE_OPTIONS is inherited, this file
 * runs in the API child too, and there, and only there, it repoints the three database variables at the restricted role. The
 * test itself keeps its admin connection.
 *
 * Nothing here can weaken a connection: with no VEXA_RESTRICTED_DATABASE_URL, or for any process that is not the API entry, it
 * does nothing.
 */
const entry = String(process.argv[1] || "").split("\\").join("/");
const restricted = process.env.VEXA_RESTRICTED_DATABASE_URL;

if (restricted && /\/apps\/api\/dist\/main\.js$/.test(entry)) {
  process.env.DATABASE_URL = restricted;
  process.env.DATABASE_URL_POOLED = restricted;
  process.env.DATABASE_URL_DIRECT = restricted;
  process.env.VEXA_API_ON_RESTRICTED_ROLE = "1";
  // A distinct application name lets the lane prove from the database which sessions are the restricted API.
  process.env.DB_POOL_APP_NAME = "vexa-pim-api-restricted";
}
