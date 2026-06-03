/**
 * ONDC Catalog Compliance Module
 *
 * ARCHITECTURAL DECISION (2026-06-03):
 * ONDC is implemented as a STANDALONE MODULE, not a ConnectorInterface implementation.
 *
 * Why not a connector:
 *   - No install/uninstall lifecycle: ONDC mappings are configuration, not per-seller auth
 *   - No credential management: ONDC has no OAuth or API key — it is a protocol, not an API
 *   - No publish path: Vexa PIM is not an ONDC Network Participant (see below)
 *   - Admin-only: Catalog compliance is a platform-level concern, not a per-seller flow
 *
 * What this module IS:
 *   A catalog compliance tool. Sellers configure field mappings from PIM attributes to
 *   ONDC protocol fields (per version + node type), then simulate the ONDC payload for
 *   individual products or bulk export the full catalog readiness report.
 *
 * What this module is NOT:
 *   An ONDC Network Participant. Becoming an NP requires:
 *     1. Government/NIC registration as a Seller App or Gateway
 *     2. Implementation of the ONDC on_search/on_select/on_init/on_confirm flow
 *     3. BAP/BPP handshake and catalog push via the ONDC registry
 *   None of this is implemented here. This module produces the catalog payload an NP
 *   would submit — not the submission itself.
 *
 * Future connector path (if Vexa PIM becomes an NP):
 *   Create connectors/ondc/ondc.connector.ts implementing ConnectorInterface.
 *   Move payload generation here. The mapping configuration in this module
 *   becomes the field mapping layer for that connector.
 */
import { Module } from "@nestjs/common";
import { OndcController } from "./ondc.controller";
import { OndcService } from "./ondc.service";

@Module({
  controllers: [OndcController],
  providers: [OndcService],
})
export class OndcModule {}
