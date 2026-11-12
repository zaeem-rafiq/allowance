// The six store tools the shopping agent can call (U8). The model sees these definitions and the
// run service sees `dispatchTool`. No tool takes a price, a name or a total (KTD9): the store
// prices the cart on the server, so the only inputs are a product id and a quantity.
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_QUANTITY } from "@/lib/catalog/catalog";
import type { StoreTools } from "./port";

/** Smallest quantity the agent may add in one call. The largest is the catalog's MAX_QUANTITY. */
const MIN_QUANTITY = 1;
const MAX_PRODUCT_ID_LENGTH = 64;

const PRODUCT_ID = {
  type: "string",
  description: "The product's id, exactly as shown by list_products (for example, \"paper-towels\").",
} as const;

// `strict: true` makes the API check every tool call against its schema. Strict schemas cannot
// carry minimum or maximum, so the quantity range is in the description and checked in
// dispatchTool below.
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "list_products",
    description: "List every product in the store with its id, name, price and category.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "open_product_page",
    description: "Open one product's page and read its details.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { product_id: PRODUCT_ID },
      required: ["product_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_to_cart",
    description: `Add a quantity of one product to the cart. The quantity is a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}. The store sets the price.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        product_id: PRODUCT_ID,
        quantity: {
          type: "integer",
          description: `How many to add: a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`,
        },
      },
      required: ["product_id", "quantity"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_from_cart",
    description: "Remove one product from the cart.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { product_id: PRODUCT_ID },
      required: ["product_id"],
      additionalProperties: false,
    },
  },
  {
    name: "view_cart",
    description: "Show what is in the cart now, with the store's prices and total.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "checkout",
    description: "Check out the cart. You can do this once.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);

const BAD_PRODUCT_ID = "Error: product_id must be the id of a product, as shown by list_products.";
const BAD_QUANTITY = `Error: quantity must be a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`;

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function readProductId(input: unknown): string | null {
  const value = asRecord(input).product_id;
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_PRODUCT_ID_LENGTH ? id : null;
}

function readQuantity(input: unknown): number | null {
  const value = asRecord(input).quantity;
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_QUANTITY && value <= MAX_QUANTITY
    ? value
    : null;
}

/**
 * Runs one tool call from the model against the store. Checks the input first: a bad call
 * returns an "Error: ..." string for the model and never reaches the store. Fields the tool does
 * not define (such as a price) are ignored and never passed on. RunStopped from the store
 * propagates.
 */
export async function dispatchTool(tools: StoreTools, name: string, input: unknown): Promise<string> {
  switch (name) {
    case "list_products":
      return tools.listProducts();
    case "view_cart":
      return tools.viewCart();
    case "checkout":
      return tools.checkout();
    case "open_product_page": {
      const productId = readProductId(input);
      return productId === null ? BAD_PRODUCT_ID : tools.openProductPage(productId);
    }
    case "remove_from_cart": {
      const productId = readProductId(input);
      return productId === null ? BAD_PRODUCT_ID : tools.removeFromCart(productId);
    }
    case "add_to_cart": {
      const productId = readProductId(input);
      if (productId === null) return BAD_PRODUCT_ID;
      const quantity = readQuantity(input);
      if (quantity === null) return BAD_QUANTITY;
      return tools.addToCart(productId, quantity);
    }
    default:
      return `Error: unknown tool. The tools are: ${TOOL_NAMES.join(", ")}.`;
  }
}
