# Canonical Data Model v0 (Phase 0 Draft)

## Design Principles
- Channel-agnostic core schema
- Strict SKU identity
- Explicit validation issue model
- Versioned schema evolution

## Core Entities

### Tenant
- tenant_id (pk)
- name
- status

### Product
- product_id (pk)
- tenant_id (fk)
- product_type (single, parent)
- title
- description
- brand
- category_id (fk)
- status (draft, active, archived)
- schema_version

### SKU (Variant)
- sku_id (pk)
- tenant_id (fk)
- product_id (fk)
- sku_code (unique per tenant)
- barcode
- mrp
- selling_price
- inventory_qty
- status

### Category
- category_id (pk)
- tenant_id (fk, nullable for global)
- parent_category_id (fk, nullable)
- name
- path
- status

### AttributeDefinition
- attribute_id (pk)
- category_id (fk)
- name
- data_type
- required
- allowed_values (json)
- applies_to (product, sku)

### AttributeValue
- value_id (pk)
- entity_type (product, sku)
- entity_id
- attribute_id (fk)
- value_text
- value_number
- value_json

### ComplianceRule
- rule_id (pk)
- rule_name
- scope (global, category, channel)
- severity (error, warning)
- condition_expr
- remediation_text
- active

### ValidationIssue
- issue_id (pk)
- tenant_id (fk)
- entity_type
- entity_id
- channel (nullable)
- rule_id (fk)
- severity
- message
- field_path
- status (open, resolved)

### ChannelMapping
- mapping_id (pk)
- channel
- channel_version
- category_id (fk)
- canonical_field
- channel_field
- transform_rule
- required

### MediaAsset
- media_id (pk)
- tenant_id (fk)
- entity_type
- entity_id
- url
- file_type
- width
- height
- checksum

### ImportJob
- job_id (pk)
- tenant_id (fk)
- source_file
- template_id
- status
- total_rows
- success_rows
- failed_rows

### AuditEvent
- event_id (pk)
- tenant_id (fk)
- actor_id
- action
- entity_type
- entity_id
- metadata_json
- created_at

## Open Questions
- Multi-currency support timing.
- Optional supplier master in MVP vs post-MVP.
- Variant dimension normalization strategy.
