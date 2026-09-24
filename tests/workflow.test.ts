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
  type CareGuardPlugin,
} from "@/lib/care-agent/agents";
import { AGENT_NAMES } from "@/lib/care-agent/domain";
import { pendingInterruptId } from "@/lib/care-agent/turn";
import { parseReply, routed } from "@/lib/care-agent/workflow";

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
  const guard = (allow: boolean) => ({ allowRetry: vi.fn(async () => allow) }) as unknown as CareGuardPlugin & { allowRetry: ReturnType<typeof vi.fn> };

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

  it("falls back (no exception) when the error is not transient or the budget is exhausted", async () => {
    vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* () {
      throw new Error("503 UNAVAILABLE");
    });
    const out = await drain(new ResilientGemini("m", AGENT_NAMES.proposal, guard(false)).generateContentAsync(request) as AsyncGenerator<Event>);
    const parsed = JSON.parse(out[0].content!.parts![0].text!);
    expect(proposalOutputSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.fallback).toBe(true);
  });
});
