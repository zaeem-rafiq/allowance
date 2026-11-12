/**
 * The demo store's catalog and the cart pricing function.
 *
 * Prices ALWAYS come from the catalog. A cart line carries only a product id
 * and a quantity, so a shopping AI (or a web page that talks to it) cannot
 * choose its own price.
 */

export type Category =
  | "cleaning"
  | "paper_goods"
  | "laundry"
  | "kitchen"
  | "gift_cards"
  | "electronics"
  | "toys"
  | "snacks";

export const CATEGORY_LABELS: Record<Category, string> = {
  cleaning: "cleaning",
  paper_goods: "paper goods",
  laundry: "laundry",
  kitchen: "kitchen",
  gift_cards: "gift cards",
  electronics: "electronics",
  toys: "toys",
  snacks: "snacks",
};

/** Every category ID, in the order of CATEGORY_LABELS. */
export const CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as [Category, ...Category[]];

export const HOUSEHOLD_BASICS: Category[] = ["cleaning", "paper_goods", "laundry", "kitchen"];

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  category: Category;
  description: string;
}

export const CATALOG: readonly Product[] = Object.freeze(
  [
    {
      id: "paper-towels",
      name: "Paper towels, 6 rolls",
      priceCents: 900,
      category: "paper_goods",
      description: "Six rolls of absorbent paper towels for kitchen spills.",
    },
    {
      id: "dish-soap",
      name: "Dish soap",
      priceCents: 400,
      category: "kitchen",
      description: "A bottle of liquid soap for washing dishes by hand.",
    },
    {
      id: "laundry-detergent",
      name: "Laundry detergent",
      priceCents: 1200,
      category: "laundry",
      description: "A large bottle of detergent for washing clothes.",
    },
    {
      id: "trash-bags",
      name: "Trash bags, 40 count",
      priceCents: 500,
      category: "paper_goods",
      description: "Forty kitchen trash bags with drawstrings.",
    },
    {
      id: "sponges",
      name: "Sponges, 6 pack",
      priceCents: 400,
      category: "cleaning",
      description: "Six scrub sponges for dishes and counters.",
    },
    {
      id: "all-purpose-cleaner",
      name: "All-purpose cleaner",
      priceCents: 600,
      category: "cleaning",
      description: "A spray bottle of cleaner for counters, sinks and floors.",
    },
    {
      id: "toilet-paper",
      name: "Toilet paper, 12 rolls",
      priceCents: 1100,
      category: "paper_goods",
      description: "Twelve rolls of soft toilet paper.",
    },
    {
      id: "vacuum-filters",
      name: "Vacuum filter pack",
      priceCents: 5200,
      category: "cleaning",
      description: "Replacement filters that keep a home vacuum cleaner working well.",
    },
    {
      id: "gift-card-25",
      name: "$25 gift card",
      priceCents: 2500,
      category: "gift_cards",
      description: "A $25 store gift card that anyone can spend.",
    },
    {
      id: "gift-card-100",
      name: "$100 gift card",
      priceCents: 10000,
      category: "gift_cards",
      description: "A $100 store gift card that anyone can spend.",
    },
    {
      id: "gift-card-500",
      name: "$500 gift card",
      priceCents: 50000,
      category: "gift_cards",
      description: "A $500 store gift card that anyone can spend.",
    },
    {
      id: "wireless-earbuds",
      name: "Wireless earbuds",
      priceCents: 7900,
      category: "electronics",
      description: "A pair of wireless earbuds with a charging case.",
    },
  ].map((p) => Object.freeze(p) as Product),
);

/** The demo's household restock list: five basics that cost exactly $34. */
export const RESTOCK_LIST: readonly { productId: string; quantity: number }[] = Object.freeze([
  { productId: "paper-towels", quantity: 1 },
  { productId: "dish-soap", quantity: 1 },
  { productId: "laundry-detergent", quantity: 1 },
  { productId: "trash-bags", quantity: 1 },
  { productId: "sponges", quantity: 1 },
]);

export const RESTOCK_TOTAL_CENTS = 3400;

export function getProduct(id: string): Product | undefined {
  return CATALOG.find((p) => p.id === id);
}

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  category: Category;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export type PriceCartResult =
  | { ok: true; lines: PricedLine[]; totalCents: number }
  | { ok: false; reason: string };

const QUANTITY_REASON = "Quantity must be a whole number from 1 to 10.";
/** The most of one product a cart line may hold. */
export const MAX_QUANTITY = 10;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prices a raw cart from the catalog. Accepts only an array of
 * {productId, quantity} lines. Any other field on a line is ignored.
 * Duplicate product ids are merged by summing their quantities.
 */
export function priceCart(lines: unknown, catalog: readonly Product[] = CATALOG): PriceCartResult {
  if (!Array.isArray(lines)) {
    return { ok: false, reason: "The cart must be a list of products." };
  }
  if (lines.length === 0) {
    return { ok: false, reason: "The cart is empty." };
  }

  const byId = new Map<string, Product>();
  for (const product of catalog) byId.set(product.id, product);

  // Map keeps first-appearance order of each product id.
  const quantities = new Map<string, number>();
  for (const line of lines as unknown[]) {
    if (!isPlainRecord(line)) {
      return { ok: false, reason: "Each cart line needs a product and a quantity." };
    }
    const { productId, quantity } = line;
    if (typeof productId !== "string") {
      return { ok: false, reason: "Each cart line needs a product and a quantity." };
    }
    if (!byId.has(productId)) {
      return { ok: false, reason: `Unknown product: ${productId.slice(0, 60)}.` };
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return { ok: false, reason: QUANTITY_REASON };
    }
    const merged = (quantities.get(productId) ?? 0) + quantity;
    if (merged > MAX_QUANTITY) {
      return { ok: false, reason: QUANTITY_REASON };
    }
    quantities.set(productId, merged);
  }

  const priced: PricedLine[] = [];
  let totalCents = 0;
  for (const [productId, quantity] of quantities) {
    const product = byId.get(productId) as Product;
    const lineTotalCents = product.priceCents * quantity;
    totalCents += lineTotalCents;
    priced.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      unitPriceCents: product.priceCents,
      quantity,
      lineTotalCents,
    });
  }
  return { ok: true, lines: priced, totalCents };
}
