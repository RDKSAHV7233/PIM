# Connector R&D Actions (Execute Today)

Date: 2026-03-02
Owner: EL / PO

## 1) Meesho (Highest Priority)

Send to: `meesholink-integration@meesho.com`
Subject: `PIM1 Integration Request - Supplier API Credentials`

Body:

```
Hello Meesho Integration Team,

We are building an India-first product information manager (PIM1) for sellers and need to integrate with Meesho supplier flows.

Please share the process and credentials required for:
1) Merchant API access (if available)
2) Validation/ping endpoint details
3) Latest category-wise supplier Excel templates and versioning policy

Company:
Product:
Primary contact:
Expected go-live timeline:

Thanks,
<Name>
```

Record output in `RD_CONNECTORS.md` under `RD-MEESHO-1`.

## 2) Amazon SP-API Developer App

Portal: `https://developer.amazon.in/`

Complete:
1. Create developer profile
2. Register SP-API application
3. Submit review with privacy policy URL

Collect and store:
- `AMAZON_CLIENT_ID`
- `AMAZON_CLIENT_SECRET`
- `AMAZON_SANDBOX_SELLER_ID`

Record output in `RD_CONNECTORS.md` under `RD-AMAZON-1`.

## 3) Flipkart Partner Registration

Portal: Flipkart Partner Portal

Complete:
1. Register partner application
2. Enable OAuth flow details

Collect and store:
- `FLIPKART_CLIENT_ID`
- `FLIPKART_CLIENT_SECRET`

Record output in `RD_CONNECTORS.md` under `RD-FLIPKART-1`.

## 4) Internal Execution While Waiting

Proceed in parallel with:
- FOUNDATION sprint
- P5-S1
- P5-S2

Use `tasks.json` as authoritative task order and gate checks.

