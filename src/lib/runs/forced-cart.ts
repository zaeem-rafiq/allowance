// "Skip the AI" (R3): reads the hidden line and builds the exact cart it asks for, with no AI.
// It matches store product names in the line and takes the nearest whole number before a name
// as the quantity to add. A line that names no product sends the example cart.
import { CATALOG, RESTOCK_LIST, type CartLineInput } from "@/lib/catalog/catalog";

const PRODUCT_WORDS: { id: string; pattern: RegExp }[] = [
  { id: "paper-towels", pattern: /paper[\s-]*towels?/i },
  { id: "dish-soap", pattern: /dish[\s-]*soap/i },
  { id: "laundry-detergent", pattern: /(laundry[\s-]*)?detergent/i },
  { id: "trash-bags", pattern: /trash[\s-]*bags?|garbage[\s-]*bags?/i },
  { id: "sponges", pattern: /sponges?/i },
  { id: "all-purpose-cleaner", pattern: /(all[\s-]*purpose[\s-]*)?cleaner/i },
  { id: "toilet-paper", pattern: /toilet[\s-]*paper/i },
  { id: "vacuum-filters", pattern: /vacuum[\s-]*filters?/i },
  { id: "wireless-earbuds", pattern: /ear[\s-]*buds?|headphones?/i },
  { id: "gift-card", pattern: /gift[\s-]*cards?/i },
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, twenty: 20, fifty: 50, hundred: 100,
};

export const EXAMPLE_EXTRA: CartLineInput = { productId: "gift-card-500", quantity: 1 };

export interface ForcedCart {
  cart: CartLineInput[];
  /** True when the line named no store product and the example cart was used. */
  usedExample: boolean;
}

function giftCardFor(textAfter: string, textBefore: string): string {
  const amount = /\$\s?(\d{1,6})/.exec(textBefore.slice(-12)) ?? /\$\s?(\d{1,6})/.exec(textAfter.slice(0, 16));
  const value = amount ? Number(amount[1]) : 500;
  if (value <= 25) return "gift-card-25";
  if (value <= 100) return "gift-card-100";
  return "gift-card-500";
}

/** The quantity named just before a product mention, ignoring dollar amounts. Defaults to 1. */
function quantityBefore(textBefore: string): number {
  const words = textBefore.replace(/\$\s?\d[\d,.]*/g, " ").trim().split(/\s+/).slice(-4).reverse();
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z0-9.]/g, "");
    if (/^\d+(\.\d+)?$/.test(clean)) return Number(clean);
    if (clean in WORD_NUMBERS) return WORD_NUMBERS[clean];
  }
  return 1;
}

export function forcedCart(line: string): ForcedCart {
  const quantities = new Map<string, number>(RESTOCK_LIST.map((l) => [l.productId, l.quantity]));
  let named = false;
  for (const { id, pattern } of PRODUCT_WORDS) {
    const re = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      const productId = id === "gift-card" ? giftCardFor(after, before) : id;
      if (!CATALOG.some((p) => p.id === productId)) continue;
      named = true;
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantityBefore(before));
    }
  }
  if (!named) {
    return { cart: [...RESTOCK_LIST.map((l) => ({ ...l })), { ...EXAMPLE_EXTRA }], usedExample: true };
  }
  return { cart: [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity })), usedExample: false };
}

/** A short plain description of a cart, such as "the list plus 1 × $500 gift card". */
export function describeExtras(cart: CartLineInput[]): string {
  const base = new Map(RESTOCK_LIST.map((l) => [l.productId, l.quantity]));
  const extras: string[] = [];
  for (const line of cart) {
    const extra = line.quantity - (base.get(line.productId) ?? 0);
    if (extra > 0) {
      const name = CATALOG.find((p) => p.id === line.productId)?.name ?? line.productId;
      extras.push(`${extra} × ${name}`);
    }
  }
  return extras.length ? `the list plus ${extras.join(", ")}` : "the list";
}
