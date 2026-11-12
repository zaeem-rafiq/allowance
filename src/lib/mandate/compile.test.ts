// @vitest-environment node
import type Anthropic from "@anthropic-ai/sdk";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rule/route";
import { CATEGORY_LABELS, HOUSEHOLD_BASICS, type Category } from "@/lib/catalog/catalog";
import { getDb, resetDbForTests } from "@/lib/db";
import { currentOwner } from "@/lib/owner/guard";
import { setTestClock } from "@/lib/ports";
import { resetTestHooks, setTestHooks } from "@/lib/test-hooks";
import { DEMO_LEDGER_ID } from "@/lib/visitor/ledger";
import {
  CAP_NOTE,
  INTENT_EXPIRY,
  MAX_RULE_TEXT,
  type CompiledRule,
  type RuleCompiler,
  buildMandate,
  compilerOutputSchema,
  finalizeForSigning,
  ruleTextProblem,
  runCompile,
  validateCompiled,
} from "./compile";
import { DEMO_MANDATE, DEMO_RULE_TEXT, VISITOR_MAX_WEEKLY_BUDGET_CENTS } from "./demo-mandate";
import { getRuleCompiler } from "./index";
import { ScriptedCompiler, parseScriptedRule } from "./scripted-compiler";
import {
  COMPILER_OUTPUT_JSON_SCHEMA,
  RULE_COMPILER_INSTRUCTIONS,
  SONNET_MODEL,
  type CreateMessage,
  SonnetCompiler,
} from "./sonnet-compiler";
import { parseMandate } from "./schema";

// The route asks the owner guard, which needs a live Next request. Tests answer for it.
vi.mock("@/lib/owner/guard", () => ({ currentOwner: vi.fn() }));

const ALL = Object.keys(CATEGORY_LABELS) as Category[];
const AT = new Date("2026-11-11T12:00:00-06:00");

function output(overrides: Record<string, unknown> = {}, notEnforced: string[] = []) {
  return {
    rules: {
      weekly_budget_cents: 12000,
      allowed_categories: [...HOUSEHOLD_BASICS],
      never_categories: ["gift_cards"],
      ask_first_unit_price_cents: 4000,
      ...overrides,
    },
    notEnforced,
  };
}

afterEach(() => {
  resetTestHooks();
  vi.unstubAllEnvs();
});

describe("validateCompiled", () => {
  it("turns '$500 a week' into the $120 ceiling and says so", () => {
    const result = validateCompiled(output({ weekly_budget_cents: 50000 }));
    expect(result?.rules.weekly_budget_cents).toBe(12000);
    expect(result?.notes).toEqual([CAP_NOTE]);
    expect(CAP_NOTE).toBe("Capped at $120 for this public demo.");
  });

  it("leaves a budget at or under the ceiling alone, with no note", () => {
    expect(validateCompiled(output({ weekly_budget_cents: 12000 }))?.notes).toEqual([]);
    expect(validateCompiled(output({ weekly_budget_cents: 5000 }))?.rules.weekly_budget_cents).toBe(5000);
    expect(validateCompiled(output({ weekly_budget_cents: 100 }))?.rules.weekly_budget_cents).toBe(100);
  });

  it("accepts the demo rule exactly", () => {
    expect(validateCompiled(output())).toEqual({
      rules: DEMO_MANDATE.allowance_rules,
      notEnforced: [],
      notes: [],
    });
  });

  it("returns null for output that fails the schema", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "not a rule",
      42,
      [],
      {},
      { rules: "garbage" },
      { ...output(), extra: true },
      output({ extra: true }),
      output({ weekly_budget_cents: 0 }),
      output({ weekly_budget_cents: 99 }),
      output({ weekly_budget_cents: -5000 }),
      output({ weekly_budget_cents: 120.5 }),
      output({ weekly_budget_cents: "12000" }),
      output({ weekly_budget_cents: Number.NaN }),
      output({ weekly_budget_cents: Number.POSITIVE_INFINITY }),
      output({ allowed_categories: [] }),
      output({ allowed_categories: "cleaning" }),
      output({ never_categories: "gift_cards" }),
      output({ ask_first_unit_price_cents: 0 }),
      output({ ask_first_unit_price_cents: -1 }),
      output({ ask_first_unit_price_cents: 40.5 }),
      output({ ask_first_unit_price_cents: undefined }),
      output({ ask_first_unit_price_cents: 10_000_001 }),
      { rules: output().rules, notEnforced: "only on weekdays" },
      { rules: output().rules, notEnforced: [42] },
      { rules: output().rules },
    ];
    for (const value of bad) expect(validateCompiled(value), JSON.stringify(value)).toBeNull();
  });

  it("rejects 'allow everything' output that names categories the store does not sell", () => {
    expect(validateCompiled(output({ allowed_categories: ["everything"] }))).toBeNull();
    expect(validateCompiled(output({ allowed_categories: ["all"] }))).toBeNull();
    expect(validateCompiled(output({ allowed_categories: [...ALL, "weapons"] }))).toBeNull();
    expect(validateCompiled(output({ never_categories: ["nothing"] }))).toBeNull();
  });

  it("still applies the ceiling when the rule allows everything", () => {
    const result = validateCompiled(
      output({ weekly_budget_cents: 99_999_999, allowed_categories: ALL, never_categories: [], ask_first_unit_price_cents: null }),
    );
    expect(result?.rules.weekly_budget_cents).toBe(VISITOR_MAX_WEEKLY_BUDGET_CENTS);
    expect(result?.rules.allowed_categories).toEqual(ALL);
    expect(result?.notes).toEqual([CAP_NOTE]);
  });

  it("removes a never category from the allowed list and refuses a rule that allows nothing", () => {
    const result = validateCompiled(output({ allowed_categories: ALL, never_categories: ["gift_cards", "gift_cards"] }));
    expect(result?.rules.allowed_categories).toEqual(ALL.filter((c) => c !== "gift_cards"));
    expect(result?.rules.never_categories).toEqual(["gift_cards"]);
    expect(validateCompiled(output({ allowed_categories: ["toys"], never_categories: ["toys"] }))).toBeNull();
  });

  it("trims, drops empty and repeated clauses, and refuses a clause that cannot be stored", () => {
    expect(validateCompiled(output({}, ["  only on weekdays ", "", "   ", "only on weekdays", "no brand names"]))?.notEnforced).toEqual([
      "only on weekdays",
      "no brand names",
    ]);
    expect(validateCompiled(output({}, ["x".repeat(281)]))).toBeNull();
    expect(validateCompiled(output({}, ["bad\u0000clause"]))).toBeNull();
    expect(validateCompiled(output({}, ["lone \ud800 surrogate"]))).toBeNull();
    expect(validateCompiled(output({}, Array.from({ length: 11 }, (_, i) => `clause ${i}`)))).toBeNull();
  });

  it("keeps HTML in a clause as plain text", () => {
    const clause = "<img src=x onerror=alert(1)> only on weekdays";
    expect(validateCompiled(output({}, [clause]))?.notEnforced).toEqual([clause]);
  });

  it("ignores notes from the browser except the cap note on a rule that is at the ceiling", () => {
    const posted = (notes: string[], budget: number) => ({ ...output({ weekly_budget_cents: budget }), notes });
    expect(validateCompiled(posted(["Anything the browser wants to say."], 5000))?.notes).toEqual([]);
    expect(validateCompiled(posted([CAP_NOTE], 5000))?.notes).toEqual([]);
    expect(validateCompiled(posted([CAP_NOTE], 12000))?.notes).toEqual([CAP_NOTE]);
  });

  it("is stable: a validated rule validates to itself", () => {
    const once = validateCompiled(output({ weekly_budget_cents: 50000, allowed_categories: ALL }, ["only on weekdays"]));
    expect(once).not.toBeNull();
    expect(validateCompiled(once)).toEqual(once);
  });

  it("property: the budget is always between $1 and the ceiling, and the note appears only when it was lowered", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000_000 }), (budget) => {
        const result = validateCompiled(output({ weekly_budget_cents: budget }));
        if (budget < 100) return result === null;
        if (result === null) return false;
        const capped = Math.min(budget, VISITOR_MAX_WEEKLY_BUDGET_CENTS);
        return (
          result.rules.weekly_budget_cents === capped &&
          result.rules.weekly_budget_cents >= 100 &&
          result.rules.weekly_budget_cents <= VISITOR_MAX_WEEKLY_BUDGET_CENTS &&
          (result.notes.length === 1) === (budget > VISITOR_MAX_WEEKLY_BUDGET_CENTS)
        );
      }),
    );
  });

  it("property: no input makes it throw, and any rule it returns is a valid mandate", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = validateCompiled(value);
        if (result === null) return true;
        parseMandate(buildMandate("a rule", result, AT));
        return true;
      }),
    );
    const category = fc.constantFrom(...ALL, "weapons", "everything");
    fc.assert(
      fc.property(
        fc.record({
          weekly_budget_cents: fc.oneof(fc.integer({ min: -10, max: 100_000 }), fc.double()),
          allowed_categories: fc.array(category, { maxLength: 10 }),
          never_categories: fc.array(category, { maxLength: 10 }),
          ask_first_unit_price_cents: fc.option(fc.integer({ min: -10, max: 100_000 }), { nil: null }),
        }),
        fc.array(fc.string({ maxLength: 40 }), { maxLength: 12 }),
        (rules, clauses) => {
          const result = validateCompiled({ rules, notEnforced: clauses });
          if (result === null) return true;
          const { rules: r } = result;
          return (
            r.allowed_categories.length > 0 &&
            r.allowed_categories.every((c) => ALL.includes(c) && !r.never_categories.includes(c)) &&
            r.weekly_budget_cents <= VISITOR_MAX_WEEKLY_BUDGET_CENTS &&
            parseMandate(buildMandate("x", result, AT)) !== undefined
          );
        },
      ),
    );
  });
});

describe("ruleTextProblem", () => {
  it("accepts a rule up to the limit and says why it refuses the rest", () => {
    expect(ruleTextProblem(DEMO_RULE_TEXT)).toBeNull();
    expect(ruleTextProblem("x".repeat(MAX_RULE_TEXT))).toBeNull();
    expect(ruleTextProblem("x".repeat(MAX_RULE_TEXT + 1))).toBe(`Your rule is ${MAX_RULE_TEXT + 1} characters. The limit is ${MAX_RULE_TEXT}.`);
    expect(ruleTextProblem("   ")).toBe("Type your rule first.");
    expect(ruleTextProblem(undefined)).toBe("Type your rule first.");
    expect(ruleTextProblem({ text: "x" })).toBe("Type your rule first.");
    expect(ruleTextProblem("a\u0000b")).toBe("Your rule has characters that cannot be used.");
  });
});

describe("buildMandate", () => {
  const compiled = (notEnforced: string[] = []): CompiledRule => ({
    rules: DEMO_MANDATE.allowance_rules,
    notEnforced,
    notes: [],
  });

  it("builds the demo mandate from the demo rule", () => {
    expect(buildMandate(DEMO_RULE_TEXT, compiled(), AT)).toEqual(DEMO_MANDATE);
  });

  it("keeps HTML in the parent's words as a plain string", () => {
    const html = '<script>alert("hi")</script> $50 a week & <b>never</b> gift cards';
    const mandate = buildMandate(html, compiled(), AT);
    expect(mandate.natural_language_description).toBe(html);
    expect(parseMandate(JSON.parse(JSON.stringify(mandate))).natural_language_description).toBe(html);
  });

  it("stores the accepted clauses as not_enforced", () => {
    expect(buildMandate("only on weekdays, $50 a week", compiled(["only on weekdays"]), AT).not_enforced).toEqual(["only on weekdays"]);
  });

  it("refuses to sign once the demo has ended", () => {
    expect(() => buildMandate("x", compiled(), new Date(INTENT_EXPIRY))).toThrow(RangeError);
  });

  it("cannot hold more than 280 characters of the parent's words", () => {
    expect(() => buildMandate("x".repeat(MAX_RULE_TEXT + 1), compiled(), AT)).toThrow();
    expect(buildMandate("x".repeat(MAX_RULE_TEXT), compiled(), AT).natural_language_description).toHaveLength(MAX_RULE_TEXT);
  });
});

describe("finalizeForSigning", () => {
  const posted = (notEnforced: string[]) => ({ ...output({}, notEnforced), notes: [] });

  it("accepts a rule with nothing left out", () => {
    const result = finalizeForSigning(posted([]), []);
    expect(result.ok).toBe(true);
  });

  it("refuses while a clause is neither accepted nor removed", () => {
    expect(finalizeForSigning(posted(["only on weekdays"]), [])).toEqual({
      ok: false,
      error: "Accept or remove every clause under Not enforced first.",
    });
  });

  it("accepts a clause the parent accepted, and a rule from which the parent removed it", () => {
    const accepted = finalizeForSigning(posted(["only on weekdays"]), ["only on weekdays"]);
    expect(accepted.ok && accepted.compiled.notEnforced).toEqual(["only on weekdays"]);
    const removed = finalizeForSigning(posted([]), []);
    expect(removed.ok && removed.compiled.notEnforced).toEqual([]);
  });

  it("refuses an accepted clause the rule does not contain", () => {
    expect(finalizeForSigning(posted([]), ["only on weekdays"]).ok).toBe(false);
  });

  it("refuses accepted lists that are not lists of text", () => {
    for (const accepted of [undefined, null, "only on weekdays", [1], [null]]) {
      expect(finalizeForSigning(posted([]), accepted).ok, JSON.stringify(accepted)).toBe(false);
    }
  });

  it("validates the posted rule again: an over-budget or unreadable rule never gets through", () => {
    const over = finalizeForSigning({ ...posted([]), rules: { ...output().rules, weekly_budget_cents: 50000 } }, []);
    expect(over.ok && over.compiled.rules.weekly_budget_cents).toBe(12000);
    expect(finalizeForSigning({ rules: { weekly_budget_cents: 50000 } }, []).ok).toBe(false);
    expect(finalizeForSigning(null, []).ok).toBe(false);
  });
});

describe("runCompile", () => {
  const compilerReturning = (value: unknown, usage = { inputTokens: 700, outputTokens: 90 }): RuleCompiler => ({
    model: "test-compiler",
    compile: async () => ({ output: value, usage }),
  });

  it("returns the validated rule and the usage", async () => {
    const run = await runCompile(compilerReturning(output({ weekly_budget_cents: 50000 })), "$500 a week");
    expect(run.compiled?.rules.weekly_budget_cents).toBe(12000);
    expect(run.compiled?.notes).toEqual([CAP_NOTE]);
    expect(run.usage).toEqual({ inputTokens: 700, outputTokens: 90 });
  });

  it("returns no rule, but keeps the usage, when the output fails the schema", async () => {
    const run = await runCompile(compilerReturning({ rules: "garbage" }), "anything");
    expect(run.compiled).toBeNull();
    expect(run.usage).toEqual({ inputTokens: 700, outputTokens: 90 });
  });

  it("returns no rule when the compiler throws", async () => {
    const throwing: RuleCompiler = { model: "x", compile: async () => Promise.reject(new Error("503 from the API")) };
    expect(await runCompile(throwing, "anything")).toEqual({ compiled: null, usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it("gives up at the deadline and aborts the compiler, even when the compiler ignores the signal", async () => {
    let seen: AbortSignal | undefined;
    const stuck: RuleCompiler = {
      model: "x",
      compile: (_text, signal) => {
        seen = signal;
        return new Promise(() => {});
      },
    };
    const started = Date.now();
    const run = await runCompile(stuck, "anything", 30);
    expect(run.compiled).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(seen?.aborted).toBe(true);
  });

  it("cleans up nonsense usage numbers", async () => {
    const run = await runCompile(compilerReturning(output(), { inputTokens: -5, outputTokens: Number.NaN }), "x");
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("the scripted compiler", () => {
  it("reads the demo rule into exactly the demo mandate's rules", () => {
    const parsed = parseScriptedRule(DEMO_RULE_TEXT);
    expect(validateCompiled(parsed)).toEqual({ rules: DEMO_MANDATE.allowance_rules, notEnforced: [], notes: [] });
  });

  it("puts 'only on weekdays' under not enforced", () => {
    const parsed = parseScriptedRule("only on weekdays, $50 a week");
    expect(parsed.notEnforced).toEqual(["only on weekdays"]);
    expect(parsed.rules.weekly_budget_cents).toBe(5000);
    expect(parsed.rules.allowed_categories).toEqual(ALL);
    expect(parsed.rules.ask_first_unit_price_cents).toBeNull();
  });

  it("reads amounts, never lists and ask-first limits", () => {
    const parsed = parseScriptedRule("$1,200.50 per week. Never toys, no snacks. Ask me first over $15.25.");
    expect(parsed.rules.weekly_budget_cents).toBe(120050);
    expect(parsed.rules.never_categories).toEqual(["toys", "snacks"]);
    expect(parsed.rules.ask_first_unit_price_cents).toBe(1525);
  });

  it("cannot read a rule with no weekly amount", () => {
    expect(validateCompiled(parseScriptedRule("buy whatever you like"))).toBeNull();
  });

  it("'$500 a week' becomes the $120 ceiling with the note", () => {
    const compiled = validateCompiled(parseScriptedRule("$500 a week"));
    expect(compiled?.rules.weekly_budget_cents).toBe(12000);
    expect(compiled?.notes).toEqual([CAP_NOTE]);
  });

  it("gives garbage on the 'garbage' hook and waits for the deadline on the 'timeout' hook", async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    setTestHooks({ compiler: "garbage" });
    expect((await runCompile(new ScriptedCompiler(), DEMO_RULE_TEXT)).compiled).toBeNull();
    setTestHooks({ compiler: "timeout" });
    const started = Date.now();
    expect((await runCompile(new ScriptedCompiler(), DEMO_RULE_TEXT, 30)).compiled).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    resetTestHooks();
    expect((await runCompile(new ScriptedCompiler(), DEMO_RULE_TEXT)).compiled).not.toBeNull();
  });

  it("ignores the hooks outside test mode", async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    setTestHooks({ compiler: "garbage" });
    vi.stubEnv("ALLOWANCE_TEST_MODE", "");
    expect((await new ScriptedCompiler().compile(DEMO_RULE_TEXT, new AbortController().signal)).output).toMatchObject({
      rules: { weekly_budget_cents: 12000 },
    });
  });

  it("is the compiler test mode binds, and Sonnet is the one otherwise", () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    expect(getRuleCompiler().model).toBe("scripted-compiler");
    vi.stubEnv("ALLOWANCE_TEST_MODE", "");
    expect(getRuleCompiler().model).toBe(SONNET_MODEL);
  });
});

describe("the Sonnet compiler", () => {
  type Block = Record<string, unknown>;
  function reply(content: Block[], stop_reason = "end_turn", usage: Block = { input_tokens: 900, output_tokens: 120 }) {
    return { id: "msg_test", type: "message", role: "assistant", model: SONNET_MODEL, content, stop_reason, stop_sequence: null, usage } as unknown as Anthropic.Beta.Messages.BetaMessage;
  }
  function fakeModel(result: Anthropic.Beta.Messages.BetaMessage | Error) {
    const requests: Parameters<CreateMessage>[0][] = [];
    const signals: AbortSignal[] = [];
    const createMessage: CreateMessage = async (params, options) => {
      requests.push(params);
      signals.push(options.signal);
      if (result instanceof Error) throw result;
      return result;
    };
    return { createMessage, requests, signals };
  }
  const demoJson = JSON.stringify(output());

  it("asks for structured output on claude-sonnet-5-5 and returns the parsed answer", async () => {
    const model = fakeModel(reply([{ type: "text", text: demoJson }]));
    const controller = new AbortController();
    const result = await new SonnetCompiler(model.createMessage).compile(DEMO_RULE_TEXT, controller.signal);

    const [request] = model.requests;
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: COMPILER_OUTPUT_JSON_SCHEMA } });
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.fallbacks).toBe("default");
    expect(request.system).toBe(RULE_COMPILER_INSTRUCTIONS);
    expect(request.messages).toEqual([{ role: "user", content: `<rule>\n${DEMO_RULE_TEXT}\n</rule>` }]);
    expect(request).not.toHaveProperty("tool_choice");
    expect(request).not.toHaveProperty("temperature");
    expect(model.signals[0]).toBe(controller.signal);
    expect(result).toEqual({ output: JSON.parse(demoJson), usage: { inputTokens: 900, outputTokens: 120 } });
    expect(validateCompiled(result.output)?.rules).toEqual(DEMO_MANDATE.allowance_rules);
  });

  it("counts cache tokens as input", async () => {
    const model = fakeModel(
      reply([{ type: "text", text: demoJson }], "end_turn", {
        input_tokens: 100,
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 10,
        output_tokens: 7,
      }),
    );
    expect((await new SonnetCompiler(model.createMessage).compile("x", new AbortController().signal)).usage).toEqual({
      inputTokens: 150,
      outputTokens: 7,
    });
  });

  it("gives no output, but keeps the usage, for a refusal, a cut-off answer, no text or broken JSON", async () => {
    const cases: Anthropic.Beta.Messages.BetaMessage[] = [
      reply([{ type: "text", text: demoJson }], "refusal"),
      reply([{ type: "text", text: demoJson.slice(0, 40) }], "max_tokens"),
      reply([{ type: "thinking", thinking: "", signature: "s" }]),
      reply([{ type: "text", text: "not json" }]),
    ];
    for (const message of cases) {
      const result = await new SonnetCompiler(fakeModel(message).createMessage).compile("x", new AbortController().signal);
      expect(result.output).toBeNull();
      expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
      expect(validateCompiled(result.output)).toBeNull();
    }
  });

  it("lets an API error through, and the run turns it into 'could not read'", async () => {
    const compiler = new SonnetCompiler(fakeModel(new Error("overloaded")).createMessage);
    await expect(compiler.compile("x", new AbortController().signal)).rejects.toThrow("overloaded");
    expect((await runCompile(compiler, "x")).compiled).toBeNull();
  });

  it("keeps its wire schema in step with the validator's schema", () => {
    const wire = COMPILER_OUTPUT_JSON_SCHEMA;
    expect(Object.keys(wire.properties).sort()).toEqual(Object.keys(compilerOutputSchema.shape).sort());
    expect(Object.keys(wire.properties.rules.properties).sort()).toEqual(Object.keys(compilerOutputSchema.shape.rules.shape).sort());
    expect([...wire.properties.rules.required].sort()).toEqual(Object.keys(compilerOutputSchema.shape.rules.shape).sort());
    expect(wire.properties.rules.properties.allowed_categories.items.enum).toEqual(ALL);
    expect(wire.properties.rules.properties.never_categories.items.enum).toEqual(ALL);
    expect(wire.additionalProperties).toBe(false);
    expect(wire.properties.rules.additionalProperties).toBe(false);
  });

  it("tells the model the store's categories and what household basics means", () => {
    for (const category of ALL) expect(RULE_COMPILER_INSTRUCTIONS).toContain(category);
    expect(RULE_COMPILER_INSTRUCTIONS).toContain(`"Household basics" means exactly: ${HOUSEHOLD_BASICS.join(", ")}.`);
  });
});

describe("POST /api/rule", () => {
  const ORIGIN = "http://localhost:3101";

  async function call(body: unknown, options: { cookie?: string; origin?: string | null; raw?: string } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
    if (options.cookie) headers.cookie = options.cookie;
    const response = await POST(
      new Request(`${ORIGIN}/api/rule`, { method: "POST", headers, body: options.raw ?? JSON.stringify(body) }),
    );
    const setCookie = response.headers.get("set-cookie");
    return { status: response.status, data: (await response.json()) as Record<string, any>, setCookie, cookie: setCookie?.split(";")[0] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async function versions(ledgerId: string) {
    const db = await getDb();
    return db.query<{ version: number; mandate: { natural_language_description: string; not_enforced: string[] } }>(
      "SELECT version, mandate FROM mandate_versions WHERE ledger_id = $1 ORDER BY version",
      [ledgerId],
    );
  }

  const compileBody = (text: string, target = "mine") => ({ action: "compile", text, target });
  const signBody = (text: string, compiled: unknown, accepted: string[] = [], target = "mine") => ({
    action: "sign",
    text,
    compiled,
    accepted,
    target,
  });

  beforeEach(async () => {
    vi.stubEnv("ALLOWANCE_TEST_MODE", "1");
    await resetDbForTests();
    setTestClock(AT);
    vi.mocked(currentOwner).mockResolvedValue(null);
  });
  afterEach(async () => {
    setTestClock(null);
    await resetDbForTests();
  });

  it("refuses a request that does not come from the site itself", async () => {
    expect((await call(compileBody(DEMO_RULE_TEXT), { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(compileBody(DEMO_RULE_TEXT), { origin: null })).status).toBe(403);
  });

  it("refuses bad requests with a plain reason", async () => {
    expect((await call(null, { raw: "not json" })).status).toBe(400);
    expect((await call(null, { raw: "[]" })).status).toBe(400);
    expect((await call(null, { raw: "x".repeat(20_001) })).status).toBe(413);
    expect((await call({ action: "compile", text: DEMO_RULE_TEXT })).status).toBe(400);
    expect((await call({ action: "explode", text: DEMO_RULE_TEXT, target: "mine" })).status).toBe(400);
    expect((await call(compileBody("   "))).data.error).toBe("Type your rule first.");
    expect((await call(compileBody("x".repeat(281)))).data.error).toBe("Your rule is 281 characters. The limit is 280.");
    expect((await call(compileBody("a\u0000b"))).status).toBe(400);
  });

  it("reads the demo rule, signs it as version 2 of the visitor's own ledger, and sets the visitor cookie once", async () => {
    const compiled = await call(compileBody(DEMO_RULE_TEXT));
    expect(compiled.status).toBe(200);
    expect(compiled.setCookie).toMatch(/^allowance_visitor=.+HttpOnly/);
    expect(compiled.data.compiled).toEqual({ rules: DEMO_MANDATE.allowance_rules, notEnforced: [], notes: [] });
    // Reading signs and stores nothing.
    expect(await versions(DEMO_LEDGER_ID)).toHaveLength(1);

    const signed = await call(signBody(DEMO_RULE_TEXT, compiled.data.compiled), { cookie: compiled.cookie });
    expect(signed.status).toBe(200);
    expect(signed.setCookie).toBeNull();
    expect(signed.data.signed.version).toBe(2);
    expect(signed.data.signed.mandate).toEqual(DEMO_MANDATE);
    expect(signed.data.signed.hash).toMatch(/^[0-9a-f]{64}$/);

    const db = await getDb();
    const ledgers = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    expect(ledgers).toHaveLength(1);
    expect((await versions(ledgers[0].id)).map((row) => row.version)).toEqual([1, 2]);
    expect(await versions(DEMO_LEDGER_ID)).toHaveLength(1);
  });

  it("makes a new version each time, and leaves the older versions as they were", async () => {
    const first = await call(compileBody("$30 a week"));
    const cookie = first.cookie;
    const one = await call(signBody("$30 a week", first.data.compiled), { cookie });
    const second = await call(compileBody("$60 a week"), { cookie });
    const two = await call(signBody("$60 a week", second.data.compiled), { cookie });
    expect([one.data.signed.version, two.data.signed.version]).toEqual([2, 3]);
    const db = await getDb();
    const [ledger] = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    const rows = await db.query<{ version: number; mandate: { allowance_rules: { weekly_budget_cents: number } } }>(
      "SELECT version, mandate FROM mandate_versions WHERE ledger_id = $1 ORDER BY version",
      [ledger.id],
    );
    expect(rows.map((row) => [row.version, row.mandate.allowance_rules.weekly_budget_cents])).toEqual([
      [1, 12000],
      [2, 3000],
      [3, 6000],
    ]);
  });

  it("lowers '$500 a week' to $120 with a note, on reading and again on signing", async () => {
    const compiled = await call(compileBody("$500 a week, household basics only"));
    expect(compiled.data.compiled.rules.weekly_budget_cents).toBe(12000);
    expect(compiled.data.compiled.notes).toEqual([CAP_NOTE]);
    // A browser that posts a bigger budget at signing is lowered again.
    const forged = { ...compiled.data.compiled, rules: { ...compiled.data.compiled.rules, weekly_budget_cents: 99_999_999 } };
    const signed = await call(signBody("$500 a week, household basics only", forged), { cookie: compiled.cookie });
    expect(signed.data.signed.mandate.allowance_rules.weekly_budget_cents).toBe(12000);
  });

  it("says 'Could not read this rule' and keeps the earlier rule when the output fails the schema", async () => {
    setTestHooks({ compiler: "garbage" });
    const compiled = await call(compileBody(DEMO_RULE_TEXT));
    expect(compiled.status).toBe(422);
    expect(compiled.data).toEqual({ error: "Could not read this rule" });
    // The visitor still gets a cookie, so their next call finds the same ledger.
    expect(compiled.cookie).toMatch(/^allowance_visitor=/);
    const db = await getDb();
    const [ledger] = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    expect((await versions(ledger.id)).map((row) => row.version)).toEqual([1]);
  });

  it("says 'Could not read this rule' for a rule with no weekly amount", async () => {
    const compiled = await call(compileBody("buy whatever you like"));
    expect(compiled.status).toBe(422);
    expect(compiled.data.error).toBe("Could not read this rule");
  });

  it("refuses the 4th read in an hour, and a new visitor is not affected", async () => {
    const first = await call(compileBody(DEMO_RULE_TEXT));
    for (let i = 0; i < 2; i++) expect((await call(compileBody(DEMO_RULE_TEXT), { cookie: first.cookie })).status).toBe(200);
    const fourth = await call(compileBody(DEMO_RULE_TEXT), { cookie: first.cookie });
    expect(fourth.status).toBe(429);
    expect(fourth.data).toEqual({ error: "You have used this hour's rule tries." });
    // Another visitor has their own count (the address count is 18 an hour, so this one still fits).
    expect((await call(compileBody(DEMO_RULE_TEXT))).status).toBe(200);
    setTestClock(new Date(AT.getTime() + 61 * 60 * 1000));
    expect((await call(compileBody(DEMO_RULE_TEXT), { cookie: first.cookie })).status).toBe(200);
  });

  it("refuses to sign while a Not enforced clause is neither accepted nor removed", async () => {
    const compiled = await call(compileBody("only on weekdays, $50 a week"));
    expect(compiled.data.compiled.notEnforced).toEqual(["only on weekdays"]);

    const undecided = await call(signBody("only on weekdays, $50 a week", compiled.data.compiled, []), { cookie: compiled.cookie });
    expect(undecided.status).toBe(400);
    expect(undecided.data.error).toBe("Accept or remove every clause under Not enforced first.");

    const accepted = await call(signBody("only on weekdays, $50 a week", compiled.data.compiled, ["only on weekdays"]), { cookie: compiled.cookie });
    expect(accepted.status).toBe(200);
    expect(accepted.data.signed.mandate.not_enforced).toEqual(["only on weekdays"]);

    const removed = { ...compiled.data.compiled, notEnforced: [] };
    const signedWithout = await call(signBody("only on weekdays, $50 a week", removed, []), { cookie: compiled.cookie });
    expect(signedWithout.status).toBe(200);
    expect(signedWithout.data.signed.mandate.not_enforced).toEqual([]);
    expect(signedWithout.data.signed.version).toBe(accepted.data.signed.version + 1);
  });

  it("never trusts the posted rule: unknown categories and unreadable shapes are refused and nothing is stored", async () => {
    const compiled = await call(compileBody(DEMO_RULE_TEXT));
    const bad = [
      { ...compiled.data.compiled, rules: { ...compiled.data.compiled.rules, allowed_categories: ["everything"] } },
      { ...compiled.data.compiled, rules: { ...compiled.data.compiled.rules, weekly_budget_cents: 0 } },
      { rules: "garbage" },
      null,
    ];
    for (const posted of bad) {
      expect((await call(signBody(DEMO_RULE_TEXT, posted), { cookie: compiled.cookie })).status).toBe(400);
    }
    const db = await getDb();
    const [ledger] = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    expect((await versions(ledger.id)).map((row) => row.version)).toEqual([1]);
  });

  it("stores rule text containing HTML as the plain string it is", async () => {
    const html = '<script>alert("hi")</script> $50 a week, never toys';
    const compiled = await call(compileBody(html));
    const signed = await call(signBody(html, compiled.data.compiled), { cookie: compiled.cookie });
    expect(signed.status).toBe(200);
    expect(signed.data.signed.mandate.natural_language_description).toBe(html);
    const db = await getDb();
    const [ledger] = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    expect((await versions(ledger.id))[1].mandate.natural_language_description).toBe(html);
  });

  it("refuses to change the demo parent's rule without the owner, before any rule is read", async () => {
    const compiled = await call(compileBody(DEMO_RULE_TEXT, "demo"));
    expect(compiled.status).toBe(403);
    expect(compiled.setCookie).toBeNull();
    const signed = await call(signBody(DEMO_RULE_TEXT, { rules: DEMO_MANDATE.allowance_rules, notEnforced: [] }, [], "demo"));
    expect(signed.status).toBe(403);
    const db = await getDb();
    expect(await db.query("SELECT id FROM ledgers")).toHaveLength(0);
    expect(await db.query("SELECT key FROM counters")).toHaveLength(0);
  });

  it("lets the owner sign a new version of the demo parent's rule, which visitors then start from", async () => {
    vi.mocked(currentOwner).mockResolvedValue({ nonce: "n", issuedAt: AT.getTime() });
    const compiled = await call(compileBody("$80 a week, household basics only, never gift cards.", "demo"));
    expect(compiled.status).toBe(200);
    expect(compiled.setCookie).toBeNull();
    const signed = await call(signBody("$80 a week, household basics only, never gift cards.", compiled.data.compiled, [], "demo"));
    expect(signed.status).toBe(200);
    expect(signed.data.signed.version).toBe(2);
    expect((await versions(DEMO_LEDGER_ID)).map((row) => row.version)).toEqual([1, 2]);

    // The owner's compile is not counted against a visitor ledger, and no visitor ledger exists yet.
    const db = await getDb();
    expect(await db.query("SELECT id FROM ledgers WHERE kind = 'visitor'")).toHaveLength(0);
    expect(await db.query("SELECT key FROM counters WHERE key LIKE 'compile:ledger:%'")).toHaveLength(0);

    // A new visitor starts from a copy of the demo parent's current rule.
    vi.mocked(currentOwner).mockResolvedValue(null);
    const visitor = await call(compileBody("$30 a week"));
    const sign = await call(signBody("$30 a week", visitor.data.compiled), { cookie: visitor.cookie });
    const [ledger] = await db.query<{ id: string }>("SELECT id FROM ledgers WHERE kind = 'visitor'");
    const rows = await versions(ledger.id);
    expect(rows[0].mandate.natural_language_description).toBe("$80 a week, household basics only, never gift cards.");
    expect(sign.data.signed.version).toBe(2);
  });

  it("refuses to sign once the demo has ended", async () => {
    const compiled = await call(compileBody(DEMO_RULE_TEXT));
    setTestClock(new Date("2027-01-02T00:00:00-06:00"));
    const signed = await call(signBody(DEMO_RULE_TEXT, compiled.data.compiled), { cookie: compiled.cookie });
    expect(signed.status).toBe(409);
  });
});
