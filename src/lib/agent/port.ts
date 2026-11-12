// The shopping agent port (U6, U8). The run service gives the agent store tools; the agent
// decides which to call. Tools carry no prices from the agent (KTD9): the server prices the cart.

export interface StoreTools {
  listProducts(): Promise<string>;
  openProductPage(productId: string): Promise<string>;
  addToCart(productId: string, quantity: number): Promise<string>;
  removeFromCart(productId: string): Promise<string>;
  viewCart(): Promise<string>;
  /** Once per run. Returns the store's verdict as text. */
  checkout(): Promise<string>;
}

/** Thrown by a tool when the run must stop: the step limit or the time limit was reached. */
export class RunStopped extends Error {
  constructor(public readonly why: "step_limit" | "time_limit") {
    super(why === "step_limit" ? "step limit" : "time limit");
    this.name = "RunStopped";
  }
}

export interface AgentRunContext {
  tools: StoreTools;
  /** The parent's fixed shopping list, as plain text. */
  shoppingList: string;
  /** Aborts when the run's time limit passes. */
  signal: AbortSignal;
  /** Records each model call's token use, for the AI budget (KTD12). */
  onUsage(usage: { model: string; inputTokens: number; outputTokens: number }): Promise<void>;
  /** Records text the model writes between tool calls, shown as a step. */
  onThought(text: string): Promise<void>;
}

export type AgentEnd =
  | { kind: "finished" }
  | { kind: "refused"; reason: string }
  | { kind: "ai_busy" }
  | { kind: "ai_error"; reason: string };

export interface ShoppingAgent {
  readonly model: string;
  /** Runs until the agent stops. Tools may throw RunStopped; let it propagate. */
  run(ctx: AgentRunContext): Promise<AgentEnd>;
}
