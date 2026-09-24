import { RequestInput, Workflow, createEvent, node, type NodeContext } from "@google/adk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AGENT_NAMES,
  BUDGET,
  QUESTION_CATALOG,
  buildLlmCaseView,
  findCatalogQuestion,
  inferNeedsFromFacts,
  maskIdentity,
  violatesStatPolicy,
  type CaseIdentity,
  type FactRow,
} from "./domain";
import {
  createCollectionAgent,
  createInterviewAgent,
  createProposalAgent,
  type CareGuardPlugin,
  type CollectionOutput,
  type InterviewOutput,
  type ProposalOutput,
} from "./agents";
import {
  createTasks,
  decideProposal,
  ensureProposalRun,
  getCurrentFacts,
  getCurrentPreferences,
  getIdentity,
  getServicesAndActions,
  getTaskTemplate,
  getUsage,
  listMessages,
  listProposalRuns,
  listProposals,
  listToolResults,
  recordUsage,
  saveFacts,
  saveMessage,
  savePreferences,
  saveProposals,
  updateCase,
  updateProposalRun,
  type SourceRow,
} from "./repo";
import {
  getEligibleServices,
  getNeedServiceCandidates,
  queryStatTable,
  searchProviders,
  type Fault,
  type ToolContext,
} from "./tools";

// ADK Graph Workflow (the Orchestrator). One consultation case = one ADK session.
// Function nodes own all product-DB writes (idempotent); LLM nodes only see sanitized input.

export type WorkflowDeps = {
  sb: SupabaseClient;
  caseId: string;
  cityCode: string | null;
  faults: ReadonlySet<Fault>;
  plugin: CareGuardPlugin;
};

/** Replies sent by the client (stringified JSON) when resuming a RequestInput pause. */
export type ClientReply =
  | { type: "message"; text: string }
  | { type: "catalog_answer"; questionId: string; value: string; label: string }
  | { type: "request_proposal" }
  | { type: "accept"; proposalId: string }
  | { type: "consult_more"; text?: string }
  | { type: "select_provider"; providerId: string | null };

export function parseReply(input: unknown): ClientReply | null {
  let raw: unknown = input;
  if (raw && typeof raw === "object" && "parts" in (raw as Record<string, unknown>)) {
    const parts = (raw as { parts?: { text?: string }[] }).parts ?? [];
    raw = parts.map((p) => p.text ?? "").join("");
  }
  if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) raw = (raw as { result: unknown }).result;
  if (typeof raw !== "string") return raw && typeof raw === "object" && "type" in raw ? (raw as ClientReply) : null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "type" in parsed ? (parsed as ClientReply) : null;
  } catch {
    return { type: "message", text: raw };
  }
}

// Spec: ask only 1–2 follow-up questions before each proposal (case-wide cap is BUDGET.question).
const QUESTIONS_PER_CYCLE = 2;

const STATE = {
  forcePropose: "force_propose",
  lastCollectionRunId: "last_collection_run_id",
  lastCollectionFingerprint: "last_collection_fingerprint",
  currentRunId: "current_run_id",
  acceptedProposalId: "accepted_proposal_id",
} as const;

/**
 * Branch nodes return their route inside the emitted event. A route set only on ctx.route is not
 * persisted to the session, so a resumed workflow (RequestInput) could not replay the branch.
 */
export function routed(ctx: NodeContext, nodeName: string, route: string, output?: unknown) {
  return createEvent({ author: nodeName, invocationId: ctx.invocationId, branch: ctx.branch, output: output ?? null, route });
}

function idem(ctx: NodeContext, suffix: string) {
  return `${ctx.invocationId}:${ctx.nodePath}:${ctx.runId}:${suffix}`;
}

function factsRecord(facts: FactRow[]) {
  return Object.fromEntries(facts.filter((f) => f.value_status === "known").map((f) => [f.fact_key, f.value]));
}

function fingerprint(facts: FactRow[]) {
  return JSON.stringify(facts.map((f) => [f.fact_key, f.value, f.value_status]).sort());
}

async function loadCaseContext(deps: WorkflowDeps) {
  const [identity, facts, preferences] = await Promise.all([
    getIdentity(deps.sb, deps.caseId),
    getCurrentFacts(deps.sb, deps.caseId),
    getCurrentPreferences(deps.sb, deps.caseId),
  ]);
  return { identity, facts, preferences, view: buildLlmCaseView(facts, preferences, identity) };
}

function toolContext(deps: WorkflowDeps, runId: string, facts: FactRow[], identity: CaseIdentity | null): ToolContext {
  return { sb: deps.sb, caseId: deps.caseId, runId, cityCode: deps.cityCode, facts: factsRecord(facts), identity, faults: deps.faults };
}

// Compact, PII-free view of stored tool results for the Proposal Agent.
/** When no question will be shown, a reply must not end by asking one. */
export function withoutTrailingQuestion(text: string) {
  const sentences = text.trim().match(/[^。！？!?]+[。！？!?]*/g) ?? [];
  while (sentences.length && /[？?]\s*$/.test(sentences[sentences.length - 1])) sentences.pop();
  const kept = sentences.join("").trim();
  return kept === text.trim() ? kept : `${kept}いただいた情報をもとに、提案をまとめます。`;
}

function compactSources(sources: SourceRow[]) {
  return sources.map((s) => ({ tool: s.tool_name, args: s.tool_args, status: s.status, result: s.result }));
}

export function createCareWorkflow(deps: WorkflowDeps) {
  let activeToolContext: ToolContext | null = null;
  const getToolContext = () => {
    if (!activeToolContext) throw new Error("tool context is not ready");
    return activeToolContext;
  };

  const careInterview = createInterviewAgent(deps.plugin);
  const infoCollection = createCollectionAgent(getToolContext, deps.plugin);
  const proposalAgent = createProposalAgent(deps.plugin);

  // --- Interview loop -------------------------------------------------------
  const prepareInterview = node(
    async (ctx: NodeContext) => {
      const { identity, view } = await loadCaseContext(deps);
      const [messages, usage] = await Promise.all([listMessages(deps.sb, deps.caseId, 40), getUsage(deps.sb, deps.caseId)]);
      const asked = messages
        .map((m) => (m.payload?.question as { catalogId?: string } | undefined)?.catalogId)
        .filter((id): id is string => Boolean(id));
      return JSON.stringify({
        caseView: view,
        conversation: messages
          .filter((m) => m.kind !== "notice")
          .slice(-12)
          .map((m) => ({ role: m.role, text: maskIdentity(m.content, identity).slice(0, 600) })),
        askedQuestionIds: asked,
        remainingQuestions: Math.max(0, BUDGET.question - usage.question),
        userRequestedProposal: ctx.state.get<boolean>(STATE.forcePropose) ?? false,
        catalog: QUESTION_CATALOG.map((q) => ({ id: q.id, text: q.text, factKey: q.factKey })),
      });
    },
    { name: "prepare_interview" },
  );

  const applyInterview = node(
    async (ctx: NodeContext, output: InterviewOutput) => {
      const prefix = idem(ctx, "interview");
      const { facts } = await loadCaseContext(deps);
      const known = factsRecord(facts);
      await saveFacts(
        deps.sb,
        deps.caseId,
        (output.factUpdates ?? [])
          .filter((f) => known[f.key] !== f.value)
          .map((f) => ({ key: f.key, value: f.value, status: f.status, source: "user_message" as const, confidence: f.confidence })),
        prefix,
      );
      await savePreferences(
        deps.sb,
        deps.caseId,
        (output.preferenceUpdates ?? []).map((p) => ({ key: p.key, value: p.value, holder: p.holder, source: "user_message" as const })),
        prefix,
      );
      const needs = output.needs?.length ? output.needs : output.fallback ? inferNeedsFromFacts(known) : [];
      await saveFacts(
        deps.sb,
        deps.caseId,
        needs.map((n) => ({ key: `need:${n}`, value: true, source: "agent_inferred" as const })),
        prefix,
      );
      const saveReply = async (asking: boolean) => {
        const text = asking ? output.assistantMessage?.trim() : withoutTrailingQuestion(output.assistantMessage ?? "");
        if (text) await saveMessage(deps.sb, deps.caseId, { role: "assistant", kind: "text", content: text }, `${prefix}:reply`);
      };

      const [usage, messages] = await Promise.all([getUsage(deps.sb, deps.caseId), listMessages(deps.sb, deps.caseId)]);
      const lastProposalIndex = messages.map((m) => m.kind).lastIndexOf("proposal");
      const questionsThisCycle = messages.slice(lastProposalIndex + 1).filter((m) => m.kind === "question").length;
      const forcePropose = ctx.state.get<boolean>(STATE.forcePropose) ?? false;
      const question = output.nextQuestion;
      const canAsk =
        !forcePropose &&
        !output.readyToPropose &&
        question?.kind !== "none" &&
        usage.question < BUDGET.question &&
        questionsThisCycle < QUESTIONS_PER_CYCLE;
      const catalog = question?.kind === "catalog" ? findCatalogQuestion(question.catalogId) : undefined;
      const freeText = question?.kind === "free_text" ? question.text?.trim() : undefined;

      if (canAsk && (catalog || freeText)) {
        const payload = catalog
          ? { kind: "catalog", catalogId: catalog.id, text: catalog.text, choices: catalog.choices }
          : { kind: "free_text", text: freeText };
        await saveReply(true);
        await saveMessage(
          deps.sb,
          deps.caseId,
          { role: "assistant", kind: "question", content: String(payload.text), payload: { question: payload } },
          `${prefix}:question`,
        );
        await recordUsage(deps.sb, deps.caseId, "question", catalog?.id ?? "free_text");
        return routed(ctx, "apply_interview", "ASK", payload);
      }
      await saveReply(false);
      ctx.state.set(STATE.forcePropose, false);
      return routed(ctx, "apply_interview", "PROPOSE", { propose: true });
    },
    { name: "apply_interview" },
  );

  const askUser = node(
    function* askUser(_ctx: NodeContext, question: { text?: string }) {
      yield new RequestInput({ message: question?.text ?? "教えてください", payload: question });
    },
    { name: "ask_user" },
  );

  const saveAnswer = node(
    async (ctx: NodeContext, input: unknown) => {
      const reply = parseReply(input);
      if (reply?.type === "catalog_answer") {
        const q = findCatalogQuestion(reply.questionId);
        const value = q?.choices.some((c) => c.value === reply.value) ? reply.value : null;
        if (q && value) {
          const status = value === "unknown" ? "unknown" : "known";
          if (q.target === "fact") {
            await saveFacts(deps.sb, deps.caseId, [{ key: q.factKey, value, status, source: "catalog_answer" }], idem(ctx, "answer"));
          } else {
            await savePreferences(
              deps.sb,
              deps.caseId,
              [{ key: q.factKey, value, holder: q.holder ?? "family", source: "catalog_answer" }],
              idem(ctx, "answer"),
            );
          }
        }
      }
      if (reply?.type === "request_proposal") ctx.state.set(STATE.forcePropose, true);
      return { answered: true };
    },
    { name: "save_answer" },
  );

  // --- Information collection ------------------------------------------------
  const prepareCollection = node(
    async (ctx: NodeContext) => {
      const runs = await listProposalRuns(deps.sb, deps.caseId);
      const round = runs.length + 1;
      if (round > BUDGET.proposal) {
        await saveMessage(
          deps.sb,
          deps.caseId,
          { role: "assistant", kind: "notice", content: "このデモでは提案は3回までです。これまでの提案から選ぶか、地域包括支援センターやケアマネジャーにご相談ください。" },
          idem(ctx, "limit"),
        );
        return routed(ctx, "prepare_collection", "STOP");
      }
      await updateCase(deps.sb, deps.caseId, { status: "collecting" });
      const run = await ensureProposalRun(deps.sb, deps.caseId, round);
      ctx.state.set(STATE.currentRunId, run.id);
      const { identity, facts, view } = await loadCaseContext(deps);
      activeToolContext = toolContext(deps, run.id, facts, identity);
      deps.plugin.resetToolCalls();

      // Reuse the previous collection when the case facts did not change (saves Gemini requests).
      const previousRunId = ctx.state.get<string>(STATE.lastCollectionRunId);
      if (previousRunId && ctx.state.get<string>(STATE.lastCollectionFingerprint) === fingerprint(facts)) {
        await updateProposalRun(deps.sb, run.id, { agent2_control: { reusedFromRunId: previousRunId } });
        return routed(ctx, "prepare_collection", "REUSE");
      }
      const usage = await getUsage(deps.sb, deps.caseId);
      return routed(ctx, "prepare_collection", "COLLECT", JSON.stringify({
        caseView: view,
        remainingWebSearch: Math.max(0, BUDGET.web_search - usage.web_search),
        statTables: [
          { code: "K25-42", title: "要介護度×利用した介護サービス", dimensions: ["care_level", "service_category"] },
          { code: "K25-47", title: "要介護度×介護保険サービスを利用しない理由", dimensions: ["care_level", "non_use_reason"] },
          { code: "K25-69", title: "主な介護者の仕事×介護時間×続柄×利用サービス", dimensions: ["caregiver_work", "caregiving_time", "relationship", "service_category"] },
          { code: "K25-87", title: "要介護度×主な介護内容×介護者の組合せ", dimensions: ["care_level", "main_care_content", "caregiver_combination"] },
          { code: "C26-2", title: "要介護度×介護サービス種類（受給者数）", dimensions: ["care_level", "service_type"] },
          { code: "S22-37", title: "施設種類×要介護度×寝たきり度", dimensions: ["facility_type", "care_level", "bedridden_level"] },
        ],
      }));
    },
    { name: "prepare_collection" },
  );

  const afterCollection = node(
    async (ctx: NodeContext, control: CollectionOutput) => {
      const runId = ctx.state.get<string>(STATE.currentRunId)!;
      const { identity, facts } = await loadCaseContext(deps);
      // Agent② output is control information only. Which tools really ran is read from the saved
      // tool results; missing baseline lookups are completed deterministically (also covers fallback).
      const saved = await listToolResults(deps.sb, [runId]);
      const ran = new Set(saved.filter((s) => s.status !== "error").map((s) => s.tool_name));
      const supplemented: string[] = [];
      const tctx = toolContext(deps, runId, facts, identity);
      const known = factsRecord(facts);
      const needs = facts.filter((f) => f.fact_key.startsWith("need:") && f.value === true).map((f) => f.fact_key.slice(5));
      const needList = needs.length ? needs : inferNeedsFromFacts(known);
      if (!ran.has("get_eligible_services")) {
        await getEligibleServices(tctx);
        supplemented.push("get_eligible_services");
      }
      let candidates = (saved.find((s) => s.tool_name === "get_need_service_candidates" && s.status === "ok")?.result.results ?? []) as {
        service_code: string | null;
        strength: string;
      }[];
      if (!ran.has("get_need_service_candidates") && needList.length) {
        candidates = ((await getNeedServiceCandidates(tctx, needList)).results as typeof candidates) ?? [];
        supplemented.push("get_need_service_candidates");
      }
      // A stat lookup that ignored the known care level is not specific enough to cite as context.
      const statByCareLevel = saved.some(
        (s) => s.tool_name === "query_stat_table" && s.status !== "error" && ((s.result.conditioned_on as string[]) ?? []).includes("care_level"),
      );
      if (!statByCareLevel && typeof known.care_level === "string") {
        await queryStatTable(tctx, "K25-42", { care_level: known.care_level });
        supplemented.push("query_stat_table");
      }
      const primaryServices = [...new Set(candidates.filter((c) => c.service_code && c.strength === "primary").map((c) => c.service_code as string))];
      if (!ran.has("search_providers") && primaryServices.length) {
        await searchProviders(tctx, primaryServices.slice(0, 4));
        supplemented.push("search_providers");
      }
      await updateProposalRun(deps.sb, runId, {
        agent2_control: { ...control, verifiedToolsCalled: [...ran], supplementedTools: supplemented },
      });
      ctx.state.set(STATE.lastCollectionRunId, runId);
      ctx.state.set(STATE.lastCollectionFingerprint, fingerprint(facts));
      return null;
    },
    { name: "after_collection" },
  );

  const prepareProposal = node(
    async (ctx: NodeContext) => {
      await updateCase(deps.sb, deps.caseId, { status: "proposing" });
      const runId = ctx.state.get<string>(STATE.currentRunId)!;
      const sourceRunId = ctx.state.get<string>(STATE.lastCollectionRunId) ?? runId;
      const { view } = await loadCaseContext(deps);
      const sources = await listToolResults(deps.sb, [...new Set([sourceRunId, runId])]);
      const previous = (await listProposals(deps.sb, deps.caseId)).filter((p) => p.run_id !== runId);
      return JSON.stringify({
        caseView: view,
        toolResults: compactSources(sources),
        previouslyProposed: previous.map((p) => ({ targetCode: p.target_code, title: p.title })),
        instructionForRound: previous.length ? "前回と異なる観点や別の選択肢も含めて提案してください。" : undefined,
      });
    },
    { name: "prepare_proposal" },
  );

  const saveProposal = node(
    async (ctx: NodeContext, output: ProposalOutput) => {
      const runId = ctx.state.get<string>(STATE.currentRunId)!;
      const sourceRunId = ctx.state.get<string>(STATE.lastCollectionRunId) ?? runId;
      const sources = await listToolResults(deps.sb, [...new Set([sourceRunId, runId])]);
      const rules = (sources.find((s) => s.tool_name === "get_eligible_services")?.result.results ?? []) as {
        target: { type: string; code: string };
        effect: string;
      }[];
      const blocked = new Set(rules.filter((r) => r.effect === "not_eligible_in_principle").map((r) => r.target.code));

      let proposals = output?.fallback ? await deterministicProposals(sources) : output?.proposals ?? [];
      proposals = proposals.filter((p) => !blocked.has(p.targetCode));
      if (!proposals.length) proposals = await deterministicProposals(sources);

      // Grounding: identifiers the model cites must exist in the saved tool results.
      const knownRuleIds = new Set(rules.map((r) => (r as unknown as { ruleId: string }).ruleId));
      const statSources = sources.filter((s) => s.tool_name === "query_stat_table" && s.status !== "error");
      const knownTables = new Set(statSources.map((s) => String(s.result.table)));
      const grounded = (text: string) => {
        const ruleRefs = text.match(/\bR[_A-Z0-9]*\d[_A-Z0-9]*\b/g) ?? [];
        const tableRefs = text.match(/\b(?:[KCS]\d{2}-[A-Z0-9]+|table_[a-z_]+)\b/g) ?? [];
        return ruleRefs.every((r) => knownRuleIds.has(r)) && tableRefs.every((t) => knownTables.has(t));
      };
      const clean = (items: string[] = []) =>
        items
          .filter(grounded)
          // Internal field names are not user-facing text.
          .map((s) => s.replace(/\s*[（(][^（）()]*\b(?:not_)?conditioned_on\b[^（）()]*[）)]/g, "").replace(/\b(?:not_)?conditioned_on\b/g, "条件"))
          .map((s) => (violatesStatPolicy(s) ? "統計は参考となる利用傾向であり、この方に適しているかは個別に確認が必要です。" : s));
      // Titles come from the service/action master, never from model text.
      const { services, actions } = await getServicesAndActions(deps.sb);
      const canonicalNames = new Map([...services, ...actions].map((s) => [s.code, s.name]));
      proposals = proposals.map((p) => ({
        ...p,
        title: canonicalNames.get(p.targetCode) ?? p.title,
        populationContext: statSources.length ? p.populationContext : [],
      }));

      await saveProposals(
        deps.sb,
        deps.caseId,
        runId,
        proposals.slice(0, 4).map((p, i) => ({
          rank: i + 1,
          target_type: p.targetType,
          target_code: p.targetCode,
          title: p.title,
          content: {
            whyCandidate: clean(p.whyCandidate),
            relatedSituations: clean(p.relatedSituations),
            institutionalBasis: clean(p.institutionalBasis),
            populationContext: clean(p.populationContext),
            unverified: clean(p.unverified),
            nextActions: clean(p.nextActions),
            generatedBy: output?.fallback ? "rule_fallback" : AGENT_NAMES.proposal,
          },
        })),
      );
      const summary = output?.fallback || !output?.summary ? "登録済みの情報と収集した情報をもとに、候補を整理しました。" : output.summary;
      await updateProposalRun(deps.sb, runId, { status: "completed", summary });
      await recordUsage(deps.sb, deps.caseId, "proposal", runId);
      await saveMessage(
        deps.sb,
        deps.caseId,
        { role: "assistant", kind: "proposal", content: summary, payload: { runId, fallback: Boolean(output?.fallback) } },
        idem(ctx, "proposal"),
      );
      await updateCase(deps.sb, deps.caseId, { status: "awaiting_decision" });
      return { runId };
    },
    { name: "save_proposal" },
  );

  async function deterministicProposals(sources: SourceRow[]): Promise<ProposalOutput["proposals"]> {
    const { services, actions } = await getServicesAndActions(deps.sb);
    const names = new Map([...services, ...actions].map((s) => [s.code, s.name]));
    const candidates = (sources.find((s) => s.tool_name === "get_need_service_candidates")?.result.results ?? []) as {
      service_code: string | null;
      action_code: string | null;
      need_label: string;
      rationale: string;
      strength: string;
    }[];
    const seen = new Set<string>();
    const picked = candidates
      .filter((c) => c.strength === "primary")
      .filter((c) => {
        const code = c.service_code ?? c.action_code!;
        if (seen.has(code)) return false;
        seen.add(code);
        return true;
      })
      .slice(0, 3)
      .map((c) => ({
        targetType: (c.service_code ? "service" : "action") as "service" | "action",
        targetCode: (c.service_code ?? c.action_code)!,
        title: names.get((c.service_code ?? c.action_code)!) ?? "候補",
        whyCandidate: [`${c.need_label}に対応する候補です。`, c.rationale],
        relatedSituations: [c.need_label],
        institutionalBasis: ["デモ用の簡略ルールで制度上の対象外に該当しないことを確認しました。"],
        populationContext: [],
        unverified: ["利用可能な日時", "料金", "ご本人の意向"],
        nextActions: ["家族で利用希望を確認する", "事業所や担当ケアマネジャーに相談する"],
      }));
    if (!seen.has("A002")) {
      picked.push({
        targetType: "action",
        targetCode: "A002",
        title: names.get("A002") ?? "地域包括支援センターへの相談",
        whyCandidate: ["状況を整理し、利用できる支援を一緒に確認できる相談先です。"],
        relatedSituations: ["今後どうすればよいか分からない"],
        institutionalBasis: [],
        populationContext: [],
        unverified: ["担当センターの連絡先（自治体公式情報で確認）"],
        nextActions: ["担当の地域包括支援センターを調べる"],
      });
    }
    return picked;
  }

  // --- Decision --------------------------------------------------------------
  const awaitDecision = node(
    function* awaitDecision(_ctx: NodeContext, input: { runId?: string }) {
      yield new RequestInput({ message: "提案を進めるか、他の案を相談するか選んでください。", payload: { runId: input?.runId } });
    },
    { name: "await_decision" },
  );

  const routeDecision = node(
    async (ctx: NodeContext, input: unknown) => {
      const reply = parseReply(input);
      if (reply?.type === "accept") {
        await decideProposal(deps.sb, reply.proposalId, "accepted");
        ctx.state.set(STATE.acceptedProposalId, reply.proposalId);
        await updateCase(deps.sb, deps.caseId, { status: "selecting_provider" });
        return routed(ctx, "route_decision", "ACCEPT", { proposalId: reply.proposalId });
      }
      const usage = await getUsage(deps.sb, deps.caseId);
      if (usage.proposal >= BUDGET.proposal) {
        await saveMessage(
          deps.sb,
          deps.caseId,
          { role: "assistant", kind: "notice", content: "このデモでは提案は3回までです。これまでの提案から選ぶか、地域包括支援センターやケアマネジャーにご相談ください。" },
          idem(ctx, "limit"),
        );
        return routed(ctx, "route_decision", "STOP");
      }
      await updateCase(deps.sb, deps.caseId, { status: "interviewing" });
      return routed(ctx, "route_decision", "CONSULT_MORE", { consultMore: true });
    },
    { name: "route_decision" },
  );

  // --- Providers and tasks ------------------------------------------------------
  const providerCandidates = node(
    async (ctx: NodeContext, input: { proposalId?: string }) => {
      const proposalId = input?.proposalId ?? ctx.state.get<string>(STATE.acceptedProposalId);
      const proposal = (await listProposals(deps.sb, deps.caseId)).find((p) => p.id === proposalId);
      if (!proposal || proposal.target_type !== "service") {
        return routed(ctx, "provider_candidates", "SKIP", { proposalId });
      }
      const { identity, facts } = await loadCaseContext(deps);
      const result = await searchProviders(toolContext(deps, proposal.run_id, facts, identity), [proposal.target_code]);
      const providers = (result.results as unknown[] | undefined) ?? [];
      await saveMessage(
        deps.sb,
        deps.caseId,
        {
          role: "assistant",
          kind: "provider_list",
          content: providers.length
            ? `「${proposal.title}」の周辺の事業所候補です（すべて架空のデモ事業所）。`
            : result.status === "error"
              ? "事業所情報を取得できませんでした。時間をおいて確認するか、ケアマネジャーにご相談ください。タスクは作成します。"
              : "周辺で該当する事業所が見つかりませんでした。タスクは作成します。",
          payload: { proposalId, status: result.status, providers, distanceNote: result.distanceNote ?? null },
        },
        idem(ctx, "providers"),
      );
      return routed(ctx, "provider_candidates", providers.length ? "SELECT" : "SKIP", { proposalId });
    },
    { name: "provider_candidates" },
  );

  const awaitProvider = node(
    function* awaitProvider(_ctx: NodeContext, input: { proposalId?: string }) {
      yield new RequestInput({ message: "問い合わせ先の事業所を選ぶか、あとで決めるを選んでください。", payload: input });
    },
    { name: "await_provider" },
  );

  const buildTasks = node(
    async (ctx: NodeContext, input: unknown) => {
      const reply = parseReply(input);
      const providerId = reply?.type === "select_provider" ? reply.providerId : null;
      const proposalId = ctx.state.get<string>(STATE.acceptedProposalId);
      const proposal = (await listProposals(deps.sb, deps.caseId)).find((p) => p.id === proposalId);
      if (!proposal) return null;
      const template = await getTaskTemplate(deps.sb, proposal.target_type, proposal.target_code);
      if (template) {
        await createTasks(
          deps.sb,
          deps.caseId,
          template.steps.map((step, i) => ({
            proposal_id: proposal.id,
            template_id: template.id,
            provider_id: providerId,
            step_id: step.step_id,
            title: step.title,
            detail: step.requires_official_check ? `${step.detail}（自治体公式情報を確認）` : step.detail,
            requires_official_check: step.requires_official_check,
            sort_order: i,
          })),
          `proposal:${proposal.id}`,
        );
      }
      await saveMessage(
        deps.sb,
        deps.caseId,
        {
          role: "assistant",
          kind: "tasks",
          content: `「${proposal.title}」を進めるためのタスクを作成しました。`,
          payload: { proposalId: proposal.id, templateId: template?.id ?? null, caveat: template?.caveat ?? null },
        },
        idem(ctx, "tasks"),
      );
      await updateCase(deps.sb, deps.caseId, { status: "tasks_ready" });
      return { tasksCreated: template?.steps.length ?? 0 };
    },
    { name: "build_tasks" },
  );

  const finishTurn = node(async () => null, { name: "finish_turn" });

  return new Workflow({
    name: "care_workflow",
    edges: [
      ["START", prepareInterview, careInterview, applyInterview],
      [applyInterview, { ASK: askUser, PROPOSE: prepareCollection }],
      [askUser, saveAnswer, prepareInterview],
      [prepareCollection, { COLLECT: infoCollection, REUSE: prepareProposal, STOP: finishTurn }],
      [infoCollection, afterCollection, prepareProposal, proposalAgent, saveProposal, awaitDecision, routeDecision],
      [routeDecision, { CONSULT_MORE: prepareInterview, ACCEPT: providerCandidates, STOP: finishTurn }],
      [providerCandidates, { SELECT: awaitProvider, SKIP: buildTasks }],
      [awaitProvider, buildTasks],
    ],
  });
}

// Node names exposed for progress reporting and tests.
export const NODE_PROGRESS: Record<string, string> = {
  prepare_interview: "状況を整理しています",
  [AGENT_NAMES.interview]: "相談内容を理解しています",
  prepare_collection: "必要な情報を判断しています",
  [AGENT_NAMES.collection]: "制度・統計・事業所の情報を確認しています",
  after_collection: "収集した情報を保存しています",
  prepare_proposal: "提案を準備しています",
  [AGENT_NAMES.proposal]: "提案を作成しています",
  provider_candidates: "周辺の事業所を探しています",
  build_tasks: "タスクを作成しています",
};
