// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATEGORY_LABELS,
  HOUSEHOLD_BASICS,
  RESTOCK_LIST,
  RESTOCK_TOTAL_CENTS,
  getProduct,
  priceCart,
  type Category,
  type Product,
} from "./catalog";

describe("CATALOG", () => {
  it("has exactly the 12 demo products with stable ids", () => {
    expect(CATALOG.map((p) => p.id)).toEqual([
      "paper-towels",
      "dish-soap",
      "laundry-detergent",
      "trash-bags",
      "sponges",
      "all-purpose-cleaner",
      "toilet-paper",
      "vacuum-filters",
      "gift-card-25",
      "gift-card-100",
      "gift-card-500",
      "wireless-earbuds",
    ]);
  });

  it("has the agreed prices and categories", () => {
    const table = CATALOG.map((p) => [p.id, p.name, p.priceCents, p.category]);
    expect(table).toEqual([
      ["paper-towels", "Paper towels, 6 rolls", 900, "paper_goods"],
      ["dish-soap", "Dish soap", 400, "kitchen"],
      ["laundry-detergent", "Laundry detergent", 1200, "laundry"],
      ["trash-bags", "Trash bags, 40 count", 500, "paper_goods"],
      ["sponges", "Sponges, 6 pack", 400, "cleaning"],
      ["all-purpose-cleaner", "All-purpose cleaner", 600, "cleaning"],
      ["toilet-paper", "Toilet paper, 12 rolls", 1100, "paper_goods"],
      ["vacuum-filters", "Vacuum filter pack", 5200, "cleaning"],
      ["gift-card-25", "$25 gift card", 2500, "gift_cards"],
      ["gift-card-100", "$100 gift card", 10000, "gift_cards"],
      ["gift-card-500", "$500 gift card", 50000, "gift_cards"],
      ["wireless-earbuds", "Wireless earbuds", 7900, "electronics"],
    ]);
  });

  it("gives every product a one-sentence description and a whole-cent price", () => {
    for (const p of CATALOG) {
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith(".")).toBe(true);
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
    }
  });

  it("has unique ids and every category has a label", () => {
    expect(new Set(CATALOG.map((p) => p.id)).size).toBe(CATALOG.length);
    for (const p of CATALOG) expect(CATEGORY_LABELS[p.category]).toBeTruthy();
    expect(CATEGORY_LABELS.gift_cards).toBe("gift cards");
    expect(CATEGORY_LABELS.paper_goods).toBe("paper goods");
  });

  it("defines household basics as cleaning, paper goods, laundry and kitchen", () => {
    expect([...HOUSEHOLD_BASICS].sort()).toEqual(["cleaning", "kitchen", "laundry", "paper_goods"]);
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
    expect(Object.isFrozen(CATALOG[0])).toBe(true);
  });
});

describe("RESTOCK_LIST", () => {
  it("adds up to exactly $34", () => {
    const sum = RESTOCK_LIST.reduce((total, line) => {
      const product = getProduct(line.productId);
      expect(product, line.productId).toBeDefined();
      return total + (product as Product).priceCents * line.quantity;
    }, 0);
    expect(sum).toBe(3400);
    expect(RESTOCK_TOTAL_CENTS).toBe(3400);
  });

  it("matches what priceCart computes", () => {
    const priced = priceCart(RESTOCK_LIST);
    expect(priced).toMatchObject({ ok: true, totalCents: RESTOCK_TOTAL_CENTS });
  });

  it("has the five agreed products, one each", () => {
    expect(RESTOCK_LIST).toEqual([
      { productId: "paper-towels", quantity: 1 },
      { productId: "dish-soap", quantity: 1 },
      { productId: "laundry-detergent", quantity: 1 },
      { productId: "trash-bags", quantity: 1 },
      { productId: "sponges", quantity: 1 },
    ]);
  });
});

describe("getProduct", () => {
  it("finds a product by id", () => {
    expect(getProduct("vacuum-filters")?.priceCents).toBe(5200);
  });
  it("returns undefined for an unknown id, including object-prototype names", () => {
    expect(getProduct("nope")).toBeUndefined();
    expect(getProduct("__proto__")).toBeUndefined();
    expect(getProduct("constructor")).toBeUndefined();
  });
});

describe("priceCart", () => {
  it("prices lines from the catalog", () => {
    const r = priceCart([
      { productId: "paper-towels", quantity: 2 },
      { productId: "dish-soap", quantity: 1 },
    ]);
    expect(r).toEqual({
      ok: true,
      totalCents: 2200,
      lines: [
        {
          productId: "paper-towels",
          name: "Paper towels, 6 rolls",
          category: "paper_goods",
          unitPriceCents: 900,
          quantity: 2,
          lineTotalCents: 1800,
        },
        {
          productId: "dish-soap",
          name: "Dish soap",
          category: "kitchen",
          unitPriceCents: 400,
          quantity: 1,
          lineTotalCents: 400,
        },
      ],
    });
  });

  it("ignores price, name and category fields sent by the caller", () => {
    const r = priceCart([
      { productId: "gift-card-500", quantity: 1, priceCents: 1, price: 0.01, name: "Sponge", category: "cleaning" },
    ]);
    expect(r).toMatchObject({ ok: true, totalCents: 50000 });
    if (r.ok) {
      expect(r.lines[0]).toMatchObject({ unitPriceCents: 50000, category: "gift_cards", name: "$500 gift card" });
    }
  });

  it("merges duplicate product ids by summing quantity", () => {
    const r = priceCart([
      { productId: "sponges", quantity: 2 },
      { productId: "dish-soap", quantity: 1 },
      { productId: "sponges", quantity: 3 },
    ]);
    expect(r).toMatchObject({ ok: true, totalCents: 5 * 400 + 400 });
    if (r.ok) {
      expect(r.lines).toHaveLength(2);
      expect(r.lines.find((l) => l.productId === "sponges")?.quantity).toBe(5);
    }
  });

  it("re-checks the quantity limit after merging duplicates", () => {
    const r = priceCart([
      { productId: "sponges", quantity: 6 },
      { productId: "sponges", quantity: 5 },
    ]);
    expect(r).toEqual({ ok: false, reason: "Quantity must be a whole number from 1 to 10." });
  });

  it("accepts exactly 10 of a product", () => {
    expect(priceCart([{ productId: "sponges", quantity: 10 }])).toMatchObject({ ok: true, totalCents: 4000 });
    expect(
      priceCart([
        { productId: "sponges", quantity: 4 },
        { productId: "sponges", quantity: 6 },
      ]),
    ).toMatchObject({ ok: true, totalCents: 4000 });
  });

  it.each([0, -1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined, true, [2]])(
    "rejects quantity %s",
    (quantity) => {
      const r = priceCart([{ productId: "sponges", quantity }]);
      expect(r).toEqual({ ok: false, reason: "Quantity must be a whole number from 1 to 10." });
    },
  );

  it("rejects an unknown product with its name in the reason", () => {
    expect(priceCart([{ productId: "xyz", quantity: 1 }])).toEqual({
      ok: false,
      reason: "Unknown product: xyz.",
    });
  });

  it("does not resolve object-prototype names as products", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(priceCart([{ productId: id, quantity: 1 }]).ok, id).toBe(false);
    }
  });

  it("rejects an empty cart", () => {
    expect(priceCart([])).toEqual({ ok: false, reason: "The cart is empty." });
  });

  it("rejects anything that is not an array of objects", () => {
    for (const bad of [null, undefined, "paper-towels", 5, {}, { productId: "sponges", quantity: 1 }]) {
      expect(priceCart(bad).ok).toBe(false);
    }
    for (const badLine of [null, "sponges", 3, [], [["sponges", 1]]]) {
      expect(priceCart([badLine]).ok).toBe(false);
    }
    expect(priceCart([{ quantity: 1 }]).ok).toBe(false);
    expect(priceCart([{ productId: 7, quantity: 1 }]).ok).toBe(false);
  });

  it("prices from the catalog it is given, not the default one", () => {
    const custom: Product[] = [
      { id: "thirty", name: "Thirty dollar thing", priceCents: 3000, category: "cleaning", description: "A test item." },
    ];
    expect(priceCart([{ productId: "thirty", quantity: 2 }], custom)).toMatchObject({
      ok: true,
      totalCents: 6000,
    });
    expect(priceCart([{ productId: "sponges", quantity: 1 }], custom)).toEqual({
      ok: false,
      reason: "Unknown product: sponges.",
    });
  });

  it("types: categories used in the catalog are valid Category values", () => {
    const all: Category[] = Object.keys(CATEGORY_LABELS) as Category[];
    for (const p of CATALOG) expect(all).toContain(p.category);
  });
});
