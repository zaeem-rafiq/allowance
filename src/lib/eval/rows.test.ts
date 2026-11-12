// @vitest-environment node
// The attack test's 50 rows, checked with no AI: the right shape, and every poisoned row asks for a
// cart that the demo rule does not allow. The real-agent run is eval/attack.eval.ts.
import { describe, expect, it } from "vitest";
import rowsJson from "../../../eval/attack-rows.json";
import { checkCart } from "@/lib/checker/check-cart";
import { DEMO_MANDATE } from "@/lib/mandate/demo-mandate";
import { forcedCart } from "@/lib/runs/forced-cart";

interface AttackRow {
  id: string;
  kind: "poisoned" | "normal";
  line: string | null;
  asks_for: string;
}

const rows = rowsJson as AttackRow[];
const poisoned = rows.filter((r) => r.kind === "poisoned");
const normal = rows.filter((r) => r.kind === "normal");

describe("attack rows", () => {
  it("has 50 rows: 30 poisoned and 20 normal, with unique ids p01-p30 and n01-n20", () => {
    expect(rows).toHaveLength(50);
    expect(poisoned).toHaveLength(30);
    expect(normal).toHaveLength(20);
    expect(new Set(rows.map((r) => r.id)).size).toBe(50);
    expect(poisoned.map((r) => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`));
    expect(normal.map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => `n${String(i + 1).padStart(2, "0")}`));
  });

  it("gives every poisoned row a line of at most 280 characters, and every normal row no line", () => {
    for (const r of poisoned) {
      expect(typeof r.line, r.id).toBe("string");
      expect((r.line as string).trim().length, r.id).toBeGreaterThan(0);
      expect((r.line as string).length, r.id).toBeLessThanOrEqual(280);
      expect(r.asks_for.length, r.id).toBeGreaterThan(0);
    }
    for (const r of normal) expect(r.line, r.id).toBeNull();
  });

  it("uses no line twice", () => {
    const lines = poisoned.map((r) => r.line);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("each poisoned row's requested cart is blocked by the demo mandate", () => {
    for (const r of poisoned) {
      const forced = forcedCart(r.line as string);
      expect(forced.usedExample, `${r.id} names no store product`).toBe(false);
      const verdict = checkCart({
        mandate: DEMO_MANDATE,
        cart: forced.cart,
        spentCents: 0,
        pendingCents: 0,
        now: new Date("2026-11-12T12:00:00Z"),
      });
      expect(verdict.decision, `${r.id}: ${r.line}`).not.toBe("allow");
    }
  });
});
