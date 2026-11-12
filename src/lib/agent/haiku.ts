// The shopping agent, run by Claude Haiku 5.5 (U8). A plain tool-use loop: send the conversation,
// run the tools the model asks for, send the results back, stop when the model stops. Nothing
// here limits what the model may ask for. The parent's rule is enforced by code at checkout.
import Anthropic from "@anthropic-ai/sdk";
import { inputTokensFrom } from "@/lib/limits/ai-budget";
import { AGENT_INSTRUCTIONS, firstUserMessage } from "./instructions";
import { RunStopped } from "./port";
import type { AgentEnd, AgentRunContext, ShoppingAgent } from "./port";
import { TOOL_DEFINITIONS, dispatchTool } from "./tools";

export const HAIKU_MODEL = "claude-haiku-5-5";

/** Backstop only. The run service stops a run at 12 tool steps with RunStopped. */
const MAX_MODEL_CALLS = 16;
/** Thinking tokens count toward this cap, so a long think can cut a reply short. */
const MAX_TOKENS = 2048;
const RETRY_DELAY_MS = 1000;

export type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: { signal: AbortSignal },
) => Promise<Anthropic.Message>;

export interface HaikuAgentOptions {
  /** How long to wait before the one retry of a busy call. Tests set 0. */
  retryDelayMs?: number;
}

/** The real call. The client is built on first use, so building a HaikuAgent needs no key. */
function realCreateMessage(): CreateMessage {
  let client: Anthropic | undefined;
  return (params, options) => {
    // maxRetries 0: the agent counts its own retries.
    client ??= new Anthropic({ maxRetries: 0 });
    return client.messages.create(params, options);
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === "AbortError");
}

/** Overloaded (529), rate limited (429) or a server error (5xx): worth one more try. */
function isBusy(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  const status = error.status;
  return (
    error.type === "overloaded_error" ||
    status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599)
  );
}

/** A short plain reason for the owner and the visitor. Never includes the key, a request id or the API's own text. */
function plainReason(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the AI service.";
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401 || error.status === 403) return "The AI service did not accept the sign-in.";
    if (error.status === 404) return "The AI service does not know this model.";
    if (error.status === 400 || error.status === 413 || error.status === 422) {
      return "The AI service rejected the request.";
    }
    return "The AI service returned an error.";
  }
  return "The AI service had a problem.";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new RunStopped("time_limit"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RunStopped("time_limit"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type CallResult = { message: Anthropic.Message } | { end: AgentEnd };

export class HaikuAgent implements ShoppingAgent {
  readonly model = HAIKU_MODEL;
  private readonly createMessage: CreateMessage;
  private readonly retryDelayMs: number;

  constructor(createMessage?: CreateMessage, options: HaikuAgentOptions = {}) {
    this.createMessage = createMessage ?? realCreateMessage();
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  }

  async run(ctx: AgentRunContext): Promise<AgentEnd> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: firstUserMessage(ctx.shoppingList) }];

    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      const result = await this.callModel(messages, ctx);
      if ("end" in result) return result.end;
      const { message } = result;

      await ctx.onUsage({
        model: this.model,
        inputTokens: inputTokensFrom(message.usage),
        outputTokens: message.usage.output_tokens,
      });

      if (message.stop_reason === "refusal") return { kind: "refused", reason: "The AI refused to shop." };

      for (const block of message.content) {
        if (block.type !== "text") continue;
        const text = block.text.trim();
        if (text) await ctx.onThought(text);
      }

      if (message.stop_reason === "end_turn") return { kind: "finished" };
      if (message.stop_reason === "max_tokens") {
        return { kind: "ai_error", reason: "The AI's reply was cut off." };
      }
      if (message.stop_reason !== "tool_use") {
        return { kind: "ai_error", reason: "The AI stopped in an unexpected way." };
      }

      const toolUses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (toolUses.length === 0) {
        return { kind: "ai_error", reason: "The AI stopped in an unexpected way." };
      }

      // Send the whole assistant turn back unchanged (thinking blocks included), then all results in one user turn.
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        // RunStopped from a tool is not caught: it ends the run.
        const content = await dispatchTool(ctx.tools, use.name, use.input);
        results.push({ type: "tool_result", tool_use_id: use.id, content });
      }
      messages.push({ role: "user", content: results });
    }

    return { kind: "ai_error", reason: "The AI did not finish." };
  }

  /** One model call. A busy answer (529, 429, 5xx) is tried once more after a short wait. */
  private async callModel(messages: Anthropic.MessageParam[], ctx: AgentRunContext): Promise<CallResult> {
    for (let attempt = 0; ; attempt++) {
      if (ctx.signal.aborted) throw new RunStopped("time_limit");
      try {
        const message = await this.createMessage(
          {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system: AGENT_INSTRUCTIONS,
            // Haiku 5.5 thinks by default. The default effort is medium; set here so it is visible.
            output_config: { effort: "medium" },
            tools: [...TOOL_DEFINITIONS],
            tool_choice: { type: "auto" },
            // A copy, so what was sent stays as it was sent when the list grows.
            messages: [...messages],
          },
          { signal: ctx.signal },
        );
        return { message };
      } catch (error) {
        if (ctx.signal.aborted || isAbort(error)) throw new RunStopped("time_limit");
        if (!isBusy(error)) return { end: { kind: "ai_error", reason: plainReason(error) } };
        if (attempt >= 1) return { end: { kind: "ai_busy" } };
        await sleep(this.retryDelayMs, ctx.signal);
      }
    }
  }
}
