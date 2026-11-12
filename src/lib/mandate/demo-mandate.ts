import { HOUSEHOLD_BASICS } from "@/lib/catalog/catalog";
import type { IntentMandate } from "./schema";

/** The parent's rule, in the parent's words. The demo and the video use this exact sentence. */
export const DEMO_RULE_TEXT =
  "$120 a week, household basics only, nothing over $40 without asking me, never gift cards.";

/** The same rule as a mandate the checker can enforce. */
export const DEMO_MANDATE: IntentMandate = {
  type: "IntentMandate",
  natural_language_description: DEMO_RULE_TEXT,
  merchants: ["Allowance demo store"],
  skus: null,
  requires_refundability: false,
  user_cart_confirmation_required: false,
  intent_expiry: "2026-12-31T23:59:59-06:00",
  allowance_rules: {
    weekly_budget_cents: 12000,
    allowed_categories: [...HOUSEHOLD_BASICS],
    never_categories: ["gift_cards"],
    ask_first_unit_price_cents: 4000,
  },
  not_enforced: [],
};

/** A public visitor may write a rule with a budget up to this amount. */
export const VISITOR_MAX_WEEKLY_BUDGET_CENTS = 12000;
