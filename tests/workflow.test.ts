import {
  Gemini,
  InMemorySessionService,
  REQUEST_INPUT_FUNCTION_CALL_NAME,
  RequestInput,
  Runner,
  Workflow,
  node,
  type Event,
  type LlmRequest,
  type NodeContext,
} from "@google/adk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResilientGemini,
  collectionOutputSchema,
  fallbackOutput,
  interviewOutputSchema,
  proposalOutputSchema,
  retryDelayMs,
  type CareGuardPlugin,
} from "@/lib/care-agent/agents";
import { AGENT_NAMES } from "@/lib/care-agent/domain";
import { pendingInterruptId } from "@/lib/care-agent/turn";
import { parseReply, routed, withoutTrailingQuestion } from "@/lib/care-agent/workflow";

async function drain(it: AsyncGenerator<Event>) {
  const events: Event[] = [];
  for await (const e of it) events.push(e);
  return events;
}

function interruptIn(events: Event[]) {
  return events.flatMap((e) => e.content?.parts ?? []).find((p) => p.functionCall?.name === REQUEST_INPUT_FUNCTION_CALL_NAME)?.functionCall?.id;
}

describe("ADK graph routing / human-input loop", () => {
  // Same topology as the care workflow's interview loop: prep -> apply {ASK|PROPOSE}, ask -> save -> prep.
  function buildLoop(maxQuestions: number, log: string[]) {
    let asked = 0;
    const prep = node(async () => (log.push("prep"), "p"), { name: "prep" });
    const apply = node(
      async (ctx: NodeContext) => {
        log.push("apply");
        return asked++ < maxQuestions ? routed(ctx, "apply", "ASK", { q: asked }) : routed(ctx, "apply", "PROPOSE", null);
      },
      { name: "apply" },
    );
    const ask = node(
      function* ask(_ctx: NodeContext, q: unknown) {
        log.push("ask");
        yield new RequestInput({ message: "q", payload: q });
      },
      { name: "ask" },
    );
    const save = node(async (_ctx: NodeContext, input: unknown) => (log.push(`save:${input}`), "s"), { name: "save" });
    const propose = node(async () => (log.push("propose"), "done"), { name: "propose" });
    return new Workflow({ name: "wf", edges: [["START", prep, apply], [apply, { ASK: ask, PROPOSE: propose }], [ask, save, prep]] });
  }

  it("resumes a RequestInput reached through a routed edge, loops, and exits to PROPOSE", async () => {
    const log: string[] = [];
    const sessionService = new InMemorySessionService();
    const runner = new Runner({ appName: "t", agent: buildLoop(2, log), sessionService });
    const session = await sessionService.createSession({ appName: "t", userId: "u" });
    let id = interruptIn(await drain(runner.runAsync({ userId: "u", sessionId: session.id, newMessage: { role: "user", parts: [{ text: "start" }] } })));
    for (let i = 1; id; i++) {
      const stored = await sessionService.getSession({ appName: "t", userId: "u", sessionId: session.id });
      expect(pendingInterruptId(stored!.events)).toBe(id);
      id = interruptIn(
        await drain(
          runner.runAsync({
            userId: "u",
            sessionId: session.id,
            newMessage: { role: "user", parts: [{ functionResponse: { id, name: REQUEST_INPUT_FUNCTION_CALL_NAME, response: { result: `a${i}` } } }] },
          }),
        ),
      );
    }
    expect(log).toEqual(["prep", "apply", "ask", "save:a1", "prep", "apply", "ask", "save:a2", "prep", "apply", "propose"]);
    const done = await sessionService.getSession({ appName: "t", userId: "u", sessionId: session.id });
    expect(pendingInterruptId(done!.events)).toBeUndefined();
  });

  it("parses client replies from resume payloads and plain text", () => {
    expect(parseReply({ result: JSON.stringify({ type: "accept", proposalId: "p1" }) })).toEqual({ type: "accept", proposalId: "p1" });
    expect(parseReply({ parts: [{ text: JSON.stringify({ type: "consult_more" }) }] })).toEqual({ type: "consult_more" });
    expect(parseReply("自由記述です")).toEqual({ type: "message", text: "自由記述です" });
  });

  it("does not leave a dangling question when the interview moves on to proposals", () => {
    expect(withoutTrailingQuestion("よく分かりました。最後に、費用面のご心配はありますか？")).toBe("よく分かりました。いただいた情報をもとに、提案をまとめます。");
    expect(withoutTrailingQuestion("承知しました。提案を作成します。")).toBe("承知しました。提案を作成します。");
  });
});

describe("Gemini failure handling", () => {
  // Gemini is stubbed below; the constructor only needs some key to be present.
  beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "test-key-not-used"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("provides schema-valid fallback outputs for all three agents", () => {
    expect(interviewOutputSchema.safeParse(fallbackOutput(AGENT_NAMES.interview)).success).toBe(true);
    expect(collectionOutputSchema.safeParse(fallbackOutput(AGENT_NAMES.collection)).success).toBe(true);
    expect(proposalOutputSchema.safeParse(fallbackOutput(AGENT_NAMES.proposal)).success).toBe(true);
  });

  const request = { contents: [], toolsDict: {} } as unknown as LlmRequest;
  const guard = (allow: boolean) => ({ allowRetry: vi.fn(async () => allow), recordFallback: vi.fn(async () => {}) }) as unknown as CareGuardPlugin & { allowRetry: ReturnType<typeof vi.fn>; recordFallback: ReturnType<typeof vi.fn> };

  it("retries a transient 503 within budget and returns the real response", async () => {
    let calls = 0;
    vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* () {
      if (calls++ === 0) throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');
      yield { content: { role: "model", parts: [{ text: "ok" }] } };
    });
    const g = guard(true);
    const out = await drain(new ResilientGemini("m", AGENT_NAMES.interview, g).generateContentAsync(request) as AsyncGenerator<Event>);
    expect(out[0].content?.parts?.[0]?.text).toBe("ok");
    expect(g.allowRetry).toHaveBeenCalledTimes(1);
  });

  it("waits longer on rate limits, honoring the API's retryDelay (capped)", () => {
    expect(retryDelayMs("503 UNAVAILABLE", 1)).toBe(800);
    expect(retryDelayMs('429 RESOURCE_EXHAUSTED "retryDelay": "7s"', 1)).toBe(7000);
    expect(retryDelayMs("429 RESOURCE_EXHAUSTED", 2)).toBe(8000);
    expect(retryDelayMs('429 "retryDelay": "60s"', 1)).toBe(15000);
  });

  it("sends the final retry to the backup model when the primary stays rate limited", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const models: (string | undefined)[] = [];
    vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* (req: LlmRequest) {
      models.push(req.model);
      if (req.model !== "backup") throw new Error("429 RESOURCE_EXHAUSTED");
      yield { content: { role: "model", parts: [{ text: "from backup" }] } };
    });
    const run = drain(new ResilientGemini("primary", AGENT_NAMES.proposal, guard(true), "backup").generateContentAsync(request) as AsyncGenerator<Event>);
    await vi.runAllTimersAsync();
    const out = await run;
    vi.useRealTimers();
    expect(models).toEqual([undefined, undefined, "backup"]);
    expect(out[0].content?.parts?.[0]?.text).toBe("from backup");
  });

  it("falls back (no exception) when the error is not transient or the budget is exhausted", async () => {
    vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* () {
      throw new Error("503 UNAVAILABLE");
    });
    const g = guard(false);
    const out = await drain(new ResilientGemini("m", AGENT_NAMES.proposal, g).generateContentAsync(request) as AsyncGenerator<Event>);
    expect(g.recordFallback).toHaveBeenCalledWith(AGENT_NAMES.proposal, "transient_error", 1, "503 UNAVAILABLE");
    const parsed = JSON.parse(out[0].content!.parts![0].text!);
    expect(proposalOutputSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.fallback).toBe(true);
  });
});
