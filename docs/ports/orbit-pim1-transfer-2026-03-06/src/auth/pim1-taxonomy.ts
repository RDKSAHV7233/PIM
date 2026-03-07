export interface Pim1TaxonomyNode {
  id: string;
  label: string;
  parent_id: string | null;
  leaf: boolean;
  required_attributes: string[];
}

const DEFAULT_TAXONOMY: Pim1TaxonomyNode[] = [
  { id: "apparel", label: "Apparel", parent_id: null, leaf: false, required_attributes: [] },
  { id: "apparel.men", label: "Men", parent_id: "apparel", leaf: false, required_attributes: [] },
  { id: "apparel.men.shirts", label: "Men Shirts", parent_id: "apparel.men", leaf: true, required_attributes: ["title", "brand", "size", "color", "material"] },
  { id: "apparel.women", label: "Women", parent_id: "apparel", leaf: false, required_attributes: [] },
  { id: "apparel.women.dresses", label: "Women Dresses", parent_id: "apparel.women", leaf: true, required_attributes: ["title", "brand", "size", "color", "fabric"] },
  { id: "home", label: "Home", parent_id: null, leaf: false, required_attributes: [] },
  { id: "home.kitchen", label: "Kitchen", parent_id: "home", leaf: false, required_attributes: [] },
  { id: "home.kitchen.storage", label: "Kitchen Storage", parent_id: "home.kitchen", leaf: true, required_attributes: ["title", "brand", "capacity", "material"] },
  { id: "electronics", label: "Electronics", parent_id: null, leaf: false, required_attributes: [] },
  { id: "electronics.mobile", label: "Mobile", parent_id: "electronics", leaf: false, required_attributes: [] },
  { id: "electronics.mobile.accessories", label: "Mobile Accessories", parent_id: "electronics.mobile", leaf: true, required_attributes: ["title", "brand", "compatible_models"] },
];

const CONNECTOR_TAXONOMY: Record<string, Pim1TaxonomyNode[]> = {
  flipkart: DEFAULT_TAXONOMY,
  amazon: DEFAULT_TAXONOMY,
  meesho: DEFAULT_TAXONOMY,
  tally: DEFAULT_TAXONOMY,
  whatsapp: [],
};

export function taxonomyForConnector(connectorSlug: string): Pim1TaxonomyNode[] {
  const key = connectorSlug.trim().toLowerCase();
  return (CONNECTOR_TAXONOMY[key] ?? DEFAULT_TAXONOMY).map((item) => ({ ...item, required_attributes: [...item.required_attributes] }));
}

export function searchConnectorTaxonomy(input: {
  connectorSlug: string;
  query?: string;
  limit?: number;
}): Pim1TaxonomyNode[] {
  const rows = taxonomyForConnector(input.connectorSlug);
  const query = String(input.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(input.limit ?? 50))));
  if (!query) return rows.slice(0, limit);
  return rows
    .filter((row) => row.id.toLowerCase().includes(query) || row.label.toLowerCase().includes(query))
    .slice(0, limit);
}
