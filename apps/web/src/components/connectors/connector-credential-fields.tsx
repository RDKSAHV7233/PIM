import { Input } from "@/components/ui/input";

export type ConnectorCredentialFieldsMode = "install" | "credentials";

export function connectorAccountReferenceLabel(slug: string): string {
  if (slug === "amazon-in") return "Seller ID";
  if (slug === "myntra") return "Merchant ID";
  if (slug === "woocommerce") return "Site URL";
  if (slug === "odoo") return "Odoo URL";
  if (slug === "etsy") return "Shop ID";
  if (slug === "dynamics-365") return "Azure AD Tenant";
  if (slug === "prestashop") return "Store URL";
  if (slug === "bigcommerce") return "Store Hash";
  return "External Account Ref";
}

export function connectorAccountReferencePlaceholder(slug: string): string {
  if (slug === "amazon-in") return "Enter Amazon seller ID";
  if (slug === "myntra") return "Enter Myntra merchant ID";
  if (slug === "woocommerce") return "https://store.example.com";
  if (slug === "odoo") return "https://odoo.example.com";
  if (slug === "etsy") return "Enter the numeric Etsy shop ID";
  if (slug === "dynamics-365") return "Azure AD tenant ID or domain (e.g. contoso.onmicrosoft.com)";
  if (slug === "prestashop") return "https://shop.example.com";
  if (slug === "bigcommerce") return "Enter the store hash (e.g. abc123)";
  return "Optional";
}

/**
 * true for connectors whose credentials-edit flow accepts an externalAccountRef
 * change (WooCommerce site_url, Myntra merchant_id, Odoo odoo_url, Etsy shop_id,
 * Dynamics 365 aad_tenant, PrestaShop store_url, BigCommerce store_hash) —
 * matches the backend's per-connector field allowlist in
 * ConnectorInstallerService.updateCredentials() exactly. Flipkart/Amazon/
 * Meesho/eBay reject a non-empty externalAccountRef there.
 */
export function connectorCredentialsAcceptsAccountRef(slug: string): boolean {
  return (
    slug === "woocommerce" ||
    slug === "myntra" ||
    slug === "odoo" ||
    slug === "etsy" ||
    slug === "dynamics-365" ||
    slug === "prestashop" ||
    slug === "bigcommerce"
  );
}

/**
 * Renders the connector-specific credential input fields for either the
 * install form (mode="install", fields always start blank) or the
 * credentials-replace form on an existing installation (mode="credentials",
 * stored secrets can never be redisplayed, so copy makes clear what's
 * required vs. what's preserved if left blank).
 */
export function ConnectorCredentialFields({
  definitionId,
  slug,
  mode,
}: {
  definitionId: string;
  slug: string;
  mode: ConnectorCredentialFieldsMode;
}) {
  const idPrefix = mode === "install" ? "install" : "creds";

  if (slug === "flipkart") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Flipkart live install needs validated API credentials. These values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter all three fields to replace this installation's credential set — Vexa verifies them with Flipkart before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="fk-client-id" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input id={`${idPrefix}-client-secret-${definitionId}`} name="clientSecret" type="password" autoComplete="new-password" placeholder="Enter Flipkart client secret" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input id={`${idPrefix}-refresh-token-${definitionId}`} name="refreshToken" type="password" autoComplete="new-password" placeholder="Enter Flipkart refresh token" />
        </div>
      </>
    );
  }

  if (slug === "amazon-in") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Amazon India live install needs seller ID plus validated LWA (Login with Amazon) credentials. Values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter all three fields to replace this installation's credential set — Vexa verifies them with Amazon before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="amzn1.application-oa2-client.xxxxxxxx" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input id={`${idPrefix}-client-secret-${definitionId}`} name="clientSecret" type="password" autoComplete="new-password" placeholder="Enter Amazon LWA client secret" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input id={`${idPrefix}-refresh-token-${definitionId}`} name="refreshToken" type="password" autoComplete="new-password" placeholder="Enter Amazon SP-API refresh token" />
        </div>
        {mode === "install" ? (
          <>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-marketplace-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Marketplace ID
              </label>
              {/* datalist gives autocomplete while still allowing any valid ID */}
              <datalist id={`amazon-marketplace-list-${definitionId}`}>
                <option value="A21TJRUUN4KGV" />
                <option value="ATVPDKIKX0DER" />
                <option value="A2EUQ1WTGCTBG2" />
                <option value="A1F83G8C2ARO7P" />
                <option value="A1PA6795UKMFR9" />
                <option value="A13V1IB3VIYZZH" />
                <option value="APJ6JRA9NG5V4" />
                <option value="A1VC38T7YXB528" />
                <option value="A39IBJ37TRP1C6" />
                <option value="A2VIGQ35RCS4UG" />
              </datalist>
              <Input
                id={`${idPrefix}-marketplace-${definitionId}`}
                name="marketplaceId"
                list={`amazon-marketplace-list-${definitionId}`}
                defaultValue="A21TJRUUN4KGV"
                placeholder="A21TJRUUN4KGV"
                autoComplete="off"
              />
              <p className="text-xs text-slate-500">
                Pre-filled: A21TJRUUN4KGV (India). Common IDs — US: ATVPDKIKX0DER · UK: A1F83G8C2ARO7P · DE: A1PA6795UKMFR9 · JP: A1VC38T7YXB528
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-default-product-type-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Default Product Type <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <datalist id={`amazon-product-type-list-${definitionId}`}>
                <option value="SHIRT" />
                <option value="DRESS" />
                <option value="PANTS" />
                <option value="SHOES" />
                <option value="CONSUMER_ELECTRONICS" />
                <option value="MOBILE_PHONE" />
                <option value="HOME_FURNISHING" />
                <option value="KITCHEN" />
                <option value="BEAUTY" />
                <option value="BOOKS" />
                <option value="TOYS_AND_GAMES" />
                <option value="BABY_PRODUCT" />
                <option value="SPORTS" />
              </datalist>
              <Input
                id={`${idPrefix}-default-product-type-${definitionId}`}
                name="defaultProductType"
                list={`amazon-product-type-list-${definitionId}`}
                placeholder="e.g. SHIRT"
                autoComplete="off"
              />
              <p className="text-xs text-slate-500">
                Used when no per-product type is set. Leave blank if your catalog has mixed product types — you can set this per-product or update it later in the connector settings.
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">
            Marketplace ID and default product type are configured separately — see the Amazon Marketplace Configuration section below.
          </p>
        )}
      </>
    );
  }

  if (slug === "shopify") {
    // Shopify uses managed OAuth install; credential replacement isn't offered
    // (backend returns CONNECTOR_CREDENTIALS_EDIT_UNSUPPORTED for this slug).
    if (mode === "credentials") {
      return null;
    }
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Shopify uses managed install. Create the Vexa connector account with store-domain context here; managed-install lanes continue in the provider callback after the connector account is created.
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-shop-domain-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Store Domain
          </label>
          <Input
            id={`${idPrefix}-shop-domain-${definitionId}`}
            name="shopDomain"
            autoComplete="off"
            placeholder="demo-store.myshopify.com"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-access-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Admin API Access Token (SHPAT)
          </label>
          <Input
            id={`${idPrefix}-access-token-${definitionId}`}
            name="accessToken"
            type="password"
            autoComplete="new-password"
            placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID <span className="font-normal text-slate-400">(optional — managed OAuth only)</span>
          </label>
          <Input
            id={`${idPrefix}-client-id-${definitionId}`}
            name="clientId"
            autoComplete="off"
            placeholder="Leave blank for custom app / SHPAT installs"
          />
        </div>
      </>
    );
  }

  if (slug === "myntra") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Myntra credentials are issued by your Myntra account manager (PPMP/Listing Management API access). Enter the Merchant ID in the field above, then Secret Key and Warehouse ID below. All three are required. Values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter Merchant ID (above), Secret Key, and Warehouse ID to replace this installation's credential set — Vexa verifies them with Myntra before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Secret Key
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter Myntra secret key"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-warehouse-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Warehouse ID
          </label>
          <Input
            id={`${idPrefix}-warehouse-id-${definitionId}`}
            name="refreshToken"
            autoComplete="off"
            placeholder="Enter Myntra warehouse ID"
          />
        </div>
      </>
    );
  }

  if (slug === "woocommerce") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "WooCommerce uses REST API keys from WooCommerce Settings > Advanced > REST API. Enter a HTTPS store URL plus Read/Write Consumer Key and Consumer Secret. Values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter Site URL (above), Consumer Key, and Consumer Secret to replace this installation's credential set. Optional credentials left blank will keep their existing value — Vexa verifies the required fields with WooCommerce before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Consumer Key
          </label>
          <Input
            id={`${idPrefix}-client-id-${definitionId}`}
            name="clientId"
            autoComplete="off"
            placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Consumer Secret
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
        </div>
        {mode === "credentials" ? (
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-webhook-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Webhook Secret <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <Input
              id={`${idPrefix}-webhook-secret-${definitionId}`}
              name="refreshToken"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to keep the existing webhook secret"
            />
            <p className="text-xs text-slate-500">Leave blank to keep the existing webhook secret.</p>
          </div>
        ) : null}
      </>
    );
  }

  if (slug === "odoo") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Odoo authenticates via its JSON-RPC external API. Enter an HTTPS Odoo URL (above), the database name, a username, and either that user's password or an API key (Settings > Users > API Keys). Values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter all fields to replace this installation's credential set — Vexa verifies them with Odoo before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Database
          </label>
          <Input id={`${idPrefix}-refresh-token-${definitionId}`} name="refreshToken" autoComplete="off" placeholder="odoo" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Username
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="admin" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Password or API Key
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the Odoo user's password or an API key"
          />
        </div>
      </>
    );
  }

  if (slug === "etsy") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Etsy uses OAuth2 (authorization-code + PKCE). Complete the OAuth flow first to get a refresh token, then enter the Shop ID (above), Client ID (Keystring), Shared Secret, and Refresh Token here. Etsy's x-api-key requires both the Client ID and Shared Secret together — a Client ID alone is rejected."
            : "Stored secrets cannot be displayed. Re-enter all fields to replace this installation's credential set — Vexa verifies them with Etsy before saving. Etsy issues a new refresh token on every use, so the value shown after saving may differ from what you entered."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID (Keystring)
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="Enter your Etsy app's Keystring" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Shared Secret
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter your Etsy app's Shared Secret"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input
            id={`${idPrefix}-refresh-token-${definitionId}`}
            name="refreshToken"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the refresh token from the OAuth flow"
          />
        </div>
      </>
    );
  }

  if (slug === "dynamics-365") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "Dynamics 365 Business Central authenticates via an Azure AD app registration (client_credentials grant). Enter the Azure AD Tenant (above), Client ID, Client Secret, and the target Environment/Company below. Business Central addresses companies by an internal ID, not their display name, so enter the environment and company name exactly as shown in the Business Central admin center — Vexa resolves the id automatically."
            : "Stored secrets cannot be displayed. Re-enter all fields to replace this installation's credential set — Vexa verifies them with Azure AD and Business Central before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="Enter the Azure AD app registration's Application (client) ID" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the Azure AD app registration's client secret"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Environment / Company
          </label>
          <Input
            id={`${idPrefix}-refresh-token-${definitionId}`}
            name="refreshToken"
            autoComplete="off"
            placeholder='e.g. "Production|CRONUS IN"'
          />
          <p className="text-xs text-slate-500">Environment name and company name, separated by a pipe (|).</p>
        </div>
      </>
    );
  }

  if (slug === "prestashop") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "PrestaShop authenticates via its Webservice API key (Advanced Parameters > Webservice). Enter an HTTPS Store URL (above), the Webservice API Key, and the language id used for product name/description (defaults to 1 if left blank). The key needs products, categories, and languages read/write permission."
            : "Stored secrets cannot be displayed. Re-enter the Store URL (above) and Webservice API Key to replace this installation's credential set — Vexa verifies them with PrestaShop before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Webservice API Key
          </label>
          <Input
            id={`${idPrefix}-client-id-${definitionId}`}
            name="clientId"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the PrestaShop Webservice API key"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Language ID <span className="font-normal text-slate-400">(optional, defaults to 1)</span>
          </label>
          <Input id={`${idPrefix}-refresh-token-${definitionId}`} name="refreshToken" autoComplete="off" placeholder="1" />
        </div>
      </>
    );
  }

  if (slug === "ebay") {
    return (
      <>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          eBay is sandbox-only in this connector — there is no production option. Complete eBay&apos;s OAuth2 consent flow first to get a refresh token, then enter Client ID, Client Secret, and Refresh Token below.
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client ID
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="Enter your eBay app's Client ID" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Client Secret
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter your eBay app's Client Secret"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-refresh-token-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Refresh Token
          </label>
          <Input
            id={`${idPrefix}-refresh-token-${definitionId}`}
            name="refreshToken"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the refresh token from the OAuth consent flow"
          />
        </div>
        {mode === "install" ? (
          <>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-marketplace-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Marketplace ID
              </label>
              <Input id={`${idPrefix}-marketplace-${definitionId}`} name="marketplaceId" defaultValue="EBAY_US" placeholder="EBAY_US" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-fulfillment-policy-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Fulfillment Policy ID <span className="font-normal text-slate-400">(optional — required before publishing)</span>
              </label>
              <Input id={`${idPrefix}-fulfillment-policy-${definitionId}`} name="ebayFulfillmentPolicyId" autoComplete="off" placeholder="From eBay Seller Hub > Business Policies" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-payment-policy-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Payment Policy ID <span className="font-normal text-slate-400">(optional — required before publishing)</span>
              </label>
              <Input id={`${idPrefix}-payment-policy-${definitionId}`} name="ebayPaymentPolicyId" autoComplete="off" placeholder="From eBay Seller Hub > Business Policies" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-return-policy-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Return Policy ID <span className="font-normal text-slate-400">(optional — required before publishing)</span>
              </label>
              <Input id={`${idPrefix}-return-policy-${definitionId}`} name="ebayReturnPolicyId" autoComplete="off" placeholder="From eBay Seller Hub > Business Policies" />
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">
            Marketplace ID and Business Policy IDs are configured at install time and aren&apos;t changed here.
          </p>
        )}
      </>
    );
  }

  if (slug === "bigcommerce") {
    return (
      <>
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {mode === "install"
            ? "BigCommerce authenticates via a Store API account (Settings > API > Store API Accounts). Enter the Store Hash (above, from the account's API path) and its Access Token below. Values are encrypted on save and never shown again."
            : "Stored secrets cannot be displayed. Re-enter the Store Hash (above) and Access Token to replace this installation's credential set — Vexa verifies them with BigCommerce before saving."}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            API Access Token
          </label>
          <Input
            id={`${idPrefix}-client-id-${definitionId}`}
            name="clientId"
            type="password"
            autoComplete="new-password"
            placeholder="Enter the Store API account's Access Token"
          />
        </div>
      </>
    );
  }

  if (slug === "meesho") {
    // Meesho has no live credential check (RD-MEESHO-1) — credentials are
    // stored unconditionally, so this is offered in credentials mode even
    // though install doesn't currently collect them.
    if (mode !== "credentials") {
      return null;
    }
    return (
      <>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Live verification isn&apos;t available for Meesho yet — credentials are saved as entered, without a connectivity check. Re-enter both fields to replace this installation&apos;s credential set.
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-id-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Merchant ID
          </label>
          <Input id={`${idPrefix}-client-id-${definitionId}`} name="clientId" autoComplete="off" placeholder="Enter Meesho merchant ID" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-client-secret-${definitionId}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Secret Key
          </label>
          <Input
            id={`${idPrefix}-client-secret-${definitionId}`}
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder="Enter Meesho secret key"
          />
        </div>
      </>
    );
  }

  return null;
}
