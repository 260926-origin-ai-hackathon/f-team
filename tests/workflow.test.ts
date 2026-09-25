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
  diagnoseGeminiError,
  fallbackOutput,
  interviewOutputSchema,
  proposalOutputSchema,
  retryDelayMs,
  type CareGuardPlugin,
} from "@/lib/care-agent/agents";
import { AGENT_NAMES } from "@/lib/care-agent/domain";
import { pendingInterruptId } from "@/lib/care-agent/turn";
import {
  TO_PROPOSAL_MESSAGE,
  ensureConsultationProposals,
  interviewReply,
  needsFromInterview,
  parseReply,
  routed,
  targetTypeOf,
  type NeedCandidate,
} from "@/lib/care-agent/workflow";

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

  it("replaces a question lead-in by workflow state when moving on to proposals (no text parsing)", () => {
    const wantedToAsk = { assistantMessage: "最後に、費用面のご心配な点について教えていただけますでしょうか。", nextQuestion: { kind: "catalog" as const, catalogId: "cost_concern" }, readyToPropose: false };
    expect(interviewReply(wantedToAsk, true)).toBe(wantedToAsk.assistantMessage);
    expect(interviewReply(wantedToAsk, false)).toBe(TO_PROPOSAL_MESSAGE);
    const done = { assistantMessage: "承知しました。提案を作成します。", nextQuestion: { kind: "none" as const }, readyToPropose: true };
    expect(interviewReply(done, false)).toBe(done.assistantMessage);
  });

  it("turns a consultation/program question into a consultation need", () => {
    expect(needsFromInterview({ needs: ["bathing_support"], intent: "ask_consultation_or_program" }, [])).toEqual(["bathing_support", "consultation_entry"]);
    expect(needsFromInterview({ needs: ["cost_burden"], intent: "ask_consultation_or_program" }, [])).toEqual(["cost_burden"]);
    expect(needsFromInterview({ needs: [], intent: "answer" }, ["bathing_support"])).toEqual(["bathing_support"]);
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
  const guard = (allow: boolean) =>
    ({ allowRetry: vi.fn(async () => allow), recordFallback: vi.fn(async () => {}), recordAttempt: vi.fn(async () => {}) }) as unknown as CareGuardPlugin & {
      allowRetry: ReturnType<typeof vi.fn>;
      recordFallback: ReturnType<typeof vi.fn>;
      recordAttempt: ReturnType<typeof vi.fn>;
    };
  // Shape of the Gemini API free-tier daily quota error observed on 2026-09-25.
  const DAILY_QUOTA_429 =
    '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]},{"retryDelay":"13s"}]}}';

  it("summarizes a Gemini error without request/response content", () => {
    expect(diagnoseGeminiError(DAILY_QUOTA_429)).toEqual({
      httpStatus: 429,
      status: "RESOURCE_EXHAUSTED",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      retryDelay: "13s",
      message: "You exceeded your current quota, please check your plan and billing details. ",
    });
  });

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

  it("uses two requests at most: primary once, then the backup model immediately", async () => {
    const models: (string | undefined)[] = [];
    vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* (req: LlmRequest) {
      models.push(req.model);
      if (req.model !== "backup") throw new Error(DAILY_QUOTA_429);
      yield { content: { role: "model", parts: [{ text: "from backup" }] } };
    });
    const g = guard(true);
    const started = Date.now();
    const out = await drain(new ResilientGemini("primary", AGENT_NAMES.proposal, g, "backup").generateContentAsync(request) as AsyncGenerator<Event>);
    expect(models).toEqual([undefined, "backup"]);
    expect(Date.now() - started).toBeLessThan(500); // no retryDelay wait when switching models
    expect(out[0].content?.parts?.[0]?.text).toBe("from backup");
    expect(g.allowRetry).toHaveBeenCalledTimes(1);
    expect(g.recordAttempt).toHaveBeenCalledWith(AGENT_NAMES.proposal, expect.objectContaining({ model: "primary", attempt: 1, outcome: "failed", httpStatus: 429 }));
    expect(g.recordAttempt).toHaveBeenCalledWith(AGENT_NAMES.proposal, { model: "backup", attempt: 2, outcome: "ok" });
  });

  it("does not retry the same model on a daily quota (no backup) and falls back", async () => {
    const spy = vi.spyOn(Gemini.prototype, "generateContentAsync").mockImplementation(async function* () {
      throw new Error(DAILY_QUOTA_429);
    });
    const g = guard(true);
    const out = await drain(new ResilientGemini("m", AGENT_NAMES.interview, g).generateContentAsync(request) as AsyncGenerator<Event>);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(g.allowRetry).not.toHaveBeenCalled();
    expect(JSON.parse(out[0].content!.parts![0].text!).fallback).toBe(true);
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

describe("proposal categories: services, consultation windows, programs", () => {
  const names = new Map([
    ["S002", "訪問入浴介護"],
    ["A002", "地域包括支援センターへの相談"],
    ["A003", "ケアマネジャーへの相談"],
    ["P001", "高額介護サービス費"],
  ]);
  const service = (code: string) => ({
    targetType: "service" as const, targetCode: code, title: code, whyCandidate: [], relatedSituations: [], institutionalBasis: [], populationContext: [], unverified: [], nextActions: [],
  });
  const candidates: NeedCandidate[] = [
    { need_code: "bathing_support", need_label: "入浴の支援", service_code: "S002", action_code: null, strength: "primary", rationale: "r" },
    { need_code: "cost_burden", need_label: "費用負担が心配", service_code: null, action_code: "A003", strength: "primary", rationale: "r" },
    { need_code: "cost_burden", need_label: "費用負担が心配", service_code: null, action_code: "A002", strength: "secondary", rationale: "r" },
    {
      need_code: "cost_burden", need_label: "費用負担が心配", service_code: null, action_code: null, program_code: "P001", strength: "primary", rationale: "r",
      program: { name: "高額介護サービス費", conditions_note: "c", where_to_apply: "w", caveat: "k" },
    },
  ];

  it("derives the category from the code", () => {
    expect([targetTypeOf("S002"), targetTypeOf("A002"), targetTypeOf("P001")]).toEqual(["service", "action", "program"]);
  });

  it("adds a consultation window and a program when the case asks about consultation/cost and tools found them", () => {
    const out = ensureConsultationProposals([service("S002"), service("S001"), service("S005")], candidates, ["bathing_support", "cost_burden"], names);
    expect(out.map((p) => `${p.targetType}:${p.targetCode}`)).toEqual(["service:S002", "service:S001", "action:A003", "program:P001"]);
    expect(out.find((p) => p.targetCode === "A003")!.title).toBe("ケアマネジャーへの相談");
  });

  it("does not add consultation/program cards mechanically without such needs", () => {
    const proposals = [service("S002")];
    expect(ensureConsultationProposals(proposals, candidates, ["bathing_support"], names)).toBe(proposals);
  });

  it("does not add cards the tools did not return, and keeps ones the model already proposed", () => {
    expect(ensureConsultationProposals([service("S002")], candidates.slice(0, 1), ["consultation_entry"], names)).toHaveLength(1);
    const withAction = [service("S002"), { ...service("A002"), targetType: "action" as const }];
    expect(ensureConsultationProposals(withAction, candidates, ["cost_burden"], names).map((p) => p.targetCode)).toEqual(["S002", "A002", "P001"]);
  });
});
