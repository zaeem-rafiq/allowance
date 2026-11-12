/**
 * The checkout checker: plain code that compares a cart with a mandate
 * before PayPal is charged. No database, no network, no AI.
 *
 * It fails closed. Anything it cannot read (a bad cart, a bad spending
 * figure, a bad date, a mandate with unreadable rules) is a block, never an allow.
 *
 * When several rules fail, the first one in this order is the one reported:
 * bad input, expired mandate, never-allowed category, category outside the
 * allowed list, weekly budget, then ask-first.
 *
 * The verdict does not depend on the order of the cart lines. Verdict lines
 * come back in catalog order, and a rule that names products or categories
 * is chosen by that same order.
 */
import {
  CATALOG,
  CATEGORY_LABELS,
  priceCart,
  type Category,
  type PricedLine,
  type Product,
} from "@/lib/catalog/catalog";
import { formatUsd } from "@/lib/money/cents";
import { describeAllowed, type IntentMandate } from "@/lib/mandate/schema";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Adds up the charges that happened in the last 7 days (counting 0 <= now - at < 7 days).
 * A charge whose time cannot be read is counted, so that a bad record never lowers the total.
 */
export function spendInWindow(charges: { amountCents: number; at: Date }[], now: Date): number {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("spendInWindow needs a valid date for now.");
  let total = 0;
  for (const charge of charges) {
    const atMs = charge.at.getTime();
    if (!Number.isFinite(atMs)) {
      total += charge.amountCents;
      continue;
    }
    const age = nowMs - atMs;
    if (age >= 0 && age < WEEK_MS) total += charge.amountCents;
  }
  return total;
}

export type BlockCode = "bad_input" | "expired" | "never_category" | "outside_allowed" | "over_budget";

export type Verdict =
  | { decision: "allow"; totalCents: number; lines: PricedLine[]; rule: string; remainingAfterCents: number }
  | { decision: "needs_approval"; totalCents: number; lines: PricedLine[]; rule: string; overLimit: PricedLine[] }
  | {
      decision: "block";
      code: BlockCode;
      rule: string;
      reason: string;
      totalCents: number;
      lines: PricedLine[];
      remainingCents: number;
    };

export interface CheckCartInput {
  mandate: IntentMandate;
  /** Raw cart lines. They are priced with priceCart, from the catalog. */
  cart: unknown;
  /** Captured spend already inside the rolling 7-day window. */
  spentCents: number;
  /** Reserved or pending amounts. */
  pendingCents: number;
  now: Date;
  /** Defaults to CATALOG. */
  catalog?: readonly Product[];
}

interface ReadRules {
  budget: number;
  allowed: ReadonlySet<Category>;
  never: ReadonlySet<Category>;
  askFirst: number | null;
  expiryMs: number;
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCategoryList(value: unknown): value is Category[] {
  return (
    Array.isArray(value) &&
    value.every((c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, c))
  );
}

/** Reads only the fields the checker uses. Returns null when any of them cannot be trusted. */
function readRules(mandate: IntentMandate): ReadRules | null {
  try {
    const rules = mandate.allowance_rules;
    const budget = rules.weekly_budget_cents;
    if (!isMoney(budget) || budget <= 0) return null;
    if (!isCategoryList(rules.allowed_categories) || !isCategoryList(rules.never_categories)) return null;
    const askFirst = rules.ask_first_unit_price_cents;
    if (askFirst !== null && !isMoney(askFirst)) return null;
    if (typeof mandate.intent_expiry !== "string") return null;
    const expiryMs = Date.parse(mandate.intent_expiry);
    if (!Number.isFinite(expiryMs)) return null;
    return {
      budget,
      allowed: new Set(rules.allowed_categories),
      never: new Set(rules.never_categories),
      askFirst,
      expiryMs,
    };
  } catch {
    return null;
  }
}

function isValidDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === "[object Date]" && Number.isFinite((value as Date).getTime());
}

function listNames(lines: readonly PricedLine[]): string {
  const names = lines.map((l) => l.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function remaining(budget: number, spent: number, pending: number): number {
  const left = budget - spent - pending;
  return Number.isFinite(left) ? Math.max(0, left) : 0;
}

export function checkCart(input: CheckCartInput): Verdict {
  const { mandate, cart, spentCents, pendingCents, now } = input;
  const catalog = input.catalog ?? CATALOG;

  const rules = readRules(mandate);
  const spendOk = isMoney(spentCents) && isMoney(pendingCents);
  const dateOk = isValidDate(now);
  const remainingCents =
    rules !== null && spendOk ? remaining(rules.budget, spentCents, pendingCents) : 0;

  const badInput = (rule: string, reason: string): Verdict => ({
    decision: "block",
    code: "bad_input",
    rule,
    reason,
    totalCents: 0,
    lines: [],
    remainingCents,
  });

  if (rules === null) {
    return badInput("valid rule", "The spending rule could not be read, so nothing was approved.");
  }
  if (!spendOk || !dateOk) {
    return badInput("valid spending record", "This week's spending could not be read, so nothing was approved.");
  }

  const priced = priceCart(cart, catalog);
  if (!priced.ok) return badInput("valid cart", priced.reason);

  // Catalog order makes the verdict the same for any order of cart lines.
  const position = new Map<string, number>();
  catalog.forEach((product, index) => position.set(product.id, index));
  const lines = [...priced.lines].sort((a, b) => (position.get(a.productId) ?? 0) - (position.get(b.productId) ?? 0));
  const totalCents = priced.totalCents;

  const block = (code: BlockCode, rule: string, reason: string): Verdict => ({
    decision: "block",
    code,
    rule,
    reason,
    totalCents,
    lines,
    remainingCents,
  });

  // 1. Expired mandate. At the exact expiry moment the mandate is already expired.
  if (!(now.getTime() < rules.expiryMs)) {
    return block("expired", "mandate expired", "This spending rule has expired, so nothing more can be bought with it.");
  }

  // 2. A category the parent said never.
  const neverLine = lines.find((l) => rules.never.has(l.category));
  if (neverLine) {
    const label = CATEGORY_LABELS[neverLine.category];
    const offenders = lines.filter((l) => l.category === neverLine.category);
    return block(
      "never_category",
      `never ${label}`,
      `${listNames(offenders)} can't be bought under this rule: never ${label}.`,
    );
  }

  // 3. A category outside the allowed list.
  const outside = lines.filter((l) => !rules.allowed.has(l.category));
  if (outside.length > 0) {
    const allowedText = describeAllowed({ allowed_categories: [...rules.allowed] });
    return block(
      "outside_allowed",
      allowedText,
      `${listNames(outside)} can't be bought under this rule: ${allowedText}.`,
    );
  }

  // 4. Weekly budget. Written so that anything that is not clearly within budget is a block.
  const withinBudget = spentCents + pendingCents + totalCents <= rules.budget;
  if (!withinBudget) {
    const left =
      remainingCents > 0 ? `only ${formatUsd(remainingCents)} is left this week` : "nothing is left this week";
    return block(
      "over_budget",
      `${formatUsd(rules.budget)} a week`,
      `This cart is ${formatUsd(totalCents)}, and ${left}.`,
    );
  }

  // 5. Ask first: a unit price strictly above the limit needs the parent's approval.
  if (rules.askFirst !== null) {
    const limit = rules.askFirst;
    const overLimit = lines.filter((l) => l.unitPriceCents > limit);
    if (overLimit.length > 0) {
      return {
        decision: "needs_approval",
        totalCents,
        lines,
        rule: `ask me first over ${formatUsd(limit)}`,
        overLimit,
      };
    }
  }

  return {
    decision: "allow",
    totalCents,
    lines,
    rule: `within ${formatUsd(rules.budget)} a week, ${describeAllowed({ allowed_categories: [...rules.allowed] })}`,
    remainingAfterCents: rules.budget - spentCents - pendingCents - totalCents,
  };
}
