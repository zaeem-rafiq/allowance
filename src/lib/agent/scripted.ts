// The scripted agent for test mode (KTD5). It shops like the real agent would, and a test
// chooses how it treats the hidden line through the "agent" test hook.
import { RESTOCK_LIST } from "@/lib/catalog/catalog";
import { forcedCart } from "@/lib/runs/forced-cart";
import { getTestHook } from "@/lib/test-hooks";
import type { AgentEnd, AgentRunContext, ShoppingAgent } from "./port";

export type ScriptedBehavior = "follow" | "ignore" | "skip-pages" | "refuse" | "busy" | "loop" | "no-checkout";

export class ScriptedAgent implements ShoppingAgent {
  readonly model = "scripted-agent";

  constructor(private readonly behavior?: ScriptedBehavior) {}

  async run(ctx: AgentRunContext): Promise<AgentEnd> {
    const behavior = this.behavior ?? getTestHook<ScriptedBehavior>("agent") ?? "follow";
    await ctx.onUsage({ model: this.model, inputTokens: 0, outputTokens: 0 });
    if (behavior === "busy") return { kind: "ai_busy" };
    if (behavior === "refuse") return { kind: "refused", reason: "The AI refused to shop." };
    if (behavior === "loop") {
      // Keeps viewing the cart until the run's step limit stops it.
      for (;;) await ctx.tools.viewCart();
    }
    await ctx.tools.listProducts();
    let hiddenLine: string | null = null;
    for (const item of RESTOCK_LIST) {
      if (behavior !== "skip-pages") {
        const page = await ctx.tools.openProductPage(item.productId);
        const marker = page.indexOf("\n\n");
        if (marker >= 0 && page.slice(marker + 2).trim()) hiddenLine = hiddenLine ?? page.slice(marker + 2).trim();
      }
      await ctx.tools.addToCart(item.productId, item.quantity);
    }
    if (behavior === "follow" && hiddenLine) {
      await ctx.onThought("The product page asks for more items, so I will add them.");
      const wanted = forcedCart(hiddenLine).cart;
      for (const line of wanted) {
        const base = RESTOCK_LIST.find((l) => l.productId === line.productId)?.quantity ?? 0;
        const extra = line.quantity - base;
        if (extra > 0) await ctx.tools.addToCart(line.productId, Math.min(extra, 10));
      }
    }
    await ctx.tools.viewCart();
    if (behavior === "no-checkout") return { kind: "finished" };
    await ctx.tools.checkout();
    return { kind: "finished" };
  }
}
