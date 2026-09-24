import type { SupabaseClient } from "@supabase/supabase-js";
import { BUDGET, QUESTION_CATALOG, remaining } from "./domain";
import {
  getCase,
  getCurrentFacts,
  getCurrentPreferences,
  getIdentity,
  getUsage,
  listMessages,
  listProposalRuns,
  listProposals,
  listTasks,
  listToolResults,
  type MessageRow,
  type ProposalRow,
  type SourceRow,
  type TaskRow,
} from "./repo";

// Read model for the UI. Evidence shown on proposal cards comes from stored tool results, not from model text.

const FACT_LABELS: Record<string, { section: "basic" | "care" | "health" | "family"; label: string }> = {
  age: { section: "basic", label: "年齢" },
  gender: { section: "basic", label: "性別" },
  city: { section: "basic", label: "居住地" },
  household: { section: "basic", label: "世帯" },
  residence: { section: "basic", label: "現在の住まい" },
  care_level: { section: "care", label: "要介護度" },
  certification_status: { section: "care", label: "認定状況" },
  dementia: { section: "care", label: "認知症" },
  mobility: { section: "care", label: "移動" },
  bathing: { section: "care", label: "入浴" },
  toileting: { section: "care", label: "排泄" },
  eating: { section: "care", label: "食事" },
  medication_management: { section: "care", label: "服薬" },
  current_services: { section: "care", label: "利用中のサービス" },
  chronic_conditions: { section: "health", label: "持病" },
  advanced_medical_care: { section: "health", label: "高度な常時医療処置" },
  family_relationship: { section: "family", label: "続柄" },
  family_residence: { section: "family", label: "居住" },
  family_employment: { section: "family", label: "就業" },
  family_weekday_daytime: { section: "family", label: "平日昼間" },
  family_visit_frequency: { section: "family", label: "訪問可能" },
  family_main_concern: { section: "family", label: "主な悩み" },
};

const VALUE_LABELS: Record<string, string> = {
  certified: "認定済み",
  applying: "申請中",
  not_applied: "未申請",
  unknown: "分からない",
};

function displayValue(value: unknown) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return VALUE_LABELS[value] ?? value;
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  return value == null ? "未確認" : JSON.stringify(value);
}

export type ProposalEvidence = {
  rules: { ruleId: string; effect: string; explanation: string; caveat: string }[];
  nearbyProviderCount: number | null;
  statTables: { table: string; title: string; conditionedOn: string[]; notConditionedOn: string[]; multipleResponse: boolean; isDemo: boolean }[];
  webChecked: { available: boolean; sources: { title: string; url: string; official: boolean }[] } | null;
};

function evidenceFor(proposal: ProposalRow, sources: SourceRow[]): ProposalEvidence {
  const rules = sources
    .filter((s) => s.tool_name === "get_eligible_services" && s.status === "ok")
    .flatMap((s) => (s.result.results as { ruleId: string; target: { code: string }; effect: string; explanation: string; caveat: string }[]) ?? [])
    .filter((r) => r.target.code === proposal.target_code)
    .map(({ ruleId, effect, explanation, caveat }) => ({ ruleId, effect, explanation, caveat }));
  // Only searches that included this service say anything about it ("not searched" is not "none found").
  const providerResults = sources.filter(
    (s) =>
      s.tool_name === "search_providers" &&
      (s.status === "ok" || s.status === "empty") &&
      ((s.tool_args.serviceCodes as string[] | undefined) ?? []).includes(proposal.target_code),
  );
  const nearby = providerResults
    .flatMap((s) => (s.result.results as { provider_id: string; care_service_codes: string[] }[]) ?? [])
    .filter((p) => p.care_service_codes?.includes(proposal.target_code));
  const statTables = sources
    .filter((s) => s.tool_name === "query_stat_table" && (s.status === "ok" || s.status === "empty"))
    .map((s) => ({
      table: String(s.result.table),
      title: String(s.result.title),
      conditionedOn: (s.result.conditioned_on as string[]) ?? [],
      notConditionedOn: (s.result.not_conditioned_on as string[]) ?? [],
      multipleResponse: Boolean(s.result.multiple_response),
      isDemo: Boolean(s.result.is_demo),
    }));
  const web = sources.find((s) => s.tool_name === "search_official_web");
  return {
    rules,
    nearbyProviderCount: proposal.target_type === "service" && providerResults.length ? new Set(nearby.map((p) => p.provider_id)).size : null,
    statTables: [...new Map(statTables.map((t) => [t.table, t])).values()],
    webChecked: web
      ? {
          available: Boolean(web.result.available),
          sources: ((web.result.results as { title: string; url: string; official: boolean }[]) ?? []).slice(0, 3),
        }
      : null,
  };
}

export type CaseViewModel = Awaited<ReturnType<typeof buildCaseViewModel>>;

export async function buildCaseViewModel(sb: SupabaseClient, caseId: string) {
  const careCase = await getCase(sb, caseId);
  if (!careCase) return null;
  const [identity, facts, preferences, messages, runs, proposals, tasks, usage] = await Promise.all([
    getIdentity(sb, caseId),
    getCurrentFacts(sb, caseId),
    getCurrentPreferences(sb, caseId),
    listMessages(sb, caseId),
    listProposalRuns(sb, caseId),
    listProposals(sb, caseId),
    listTasks(sb, caseId),
    getUsage(sb, caseId),
  ]);
  const runIds = runs.map((r) => r.id);
  const reusedFrom = new Map(
    runs.map((r) => [r.id, (r.agent2_control as { reusedFromRunId?: string } | null)?.reusedFromRunId ?? null]),
  );
  const sources = await listToolResults(sb, [...new Set([...runIds, ...[...reusedFrom.values()].filter((v): v is string => Boolean(v))])]);

  const profile = { basic: [] as { label: string; value: string }[], care: [] as { label: string; value: string }[], health: [] as { label: string; value: string }[], family: [] as { label: string; value: string }[] };
  const learned: { label: string; value: string }[] = [];
  for (const fact of facts) {
    if (fact.fact_key.startsWith("need:")) continue;
    const meta = FACT_LABELS[fact.fact_key];
    const catalog = QUESTION_CATALOG.find((q) => q.factKey === fact.fact_key);
    const choiceLabel = catalog?.choices.find((c) => c.value === fact.value)?.label;
    const value = fact.value_status === "unknown" ? "未確認" : choiceLabel ?? (fact.fact_key === "age" && typeof fact.value === "number" ? `${fact.value}歳` : displayValue(fact.value));
    if (fact.source === "registered_profile" && meta) profile[meta.section].push({ label: meta.label, value });
    else learned.push({ label: meta?.label ?? catalog?.text ?? fact.fact_key, value });
  }
  const wishes = preferences.map((p) => ({
    holder: p.holder === "person" ? "本人" : "家族",
    value: QUESTION_CATALOG.find((q) => q.factKey === p.preference_key)?.choices.find((c) => c.value === p.value)?.label ?? displayValue(p.value),
  }));

  const runViews = runs.map((run) => {
    const runSources = sources.filter((s) => s.run_id === run.id || s.run_id === reusedFrom.get(run.id));
    return {
      id: run.id,
      round: run.round,
      status: run.status,
      proposals: proposals
        .filter((p) => p.run_id === run.id)
        .map((p) => ({ ...p, evidence: evidenceFor(p, runSources) })),
    };
  });

  const lastAssistant = [...messages].reverse().find((m: MessageRow) => m.role === "assistant" && m.kind !== "text");
  let pending: "question" | "decision" | "provider" | "tasks" | "free" = "free";
  if (careCase.status === "awaiting_decision") pending = "decision";
  else if (careCase.status === "selecting_provider" && lastAssistant?.kind === "provider_list") pending = "provider";
  else if (careCase.status === "tasks_ready") pending = "tasks";
  else if (lastAssistant?.kind === "question") pending = "question";

  const providerNames = new Map(
    sources
      .filter((s) => s.tool_name === "search_providers")
      .flatMap((s) => (s.result.results as { provider_id: string; provider_name: string }[]) ?? [])
      .map((p) => [p.provider_id, p.provider_name]),
  );

  return {
    caseId,
    status: careCase.status,
    displayName: identity?.display_name ?? "デモ利用者",
    profile,
    learned,
    wishes,
    messages,
    runs: runViews,
    tasks: tasks.map((t: TaskRow) => ({ ...t, providerName: t.provider_id ? providerNames.get(t.provider_id) ?? null : null })),
    pending,
    budget: {
      messagesLeft: remaining(usage, "user_message"),
      proposalsLeft: remaining(usage, "proposal"),
      questionsLeft: remaining(usage, "question"),
      geminiLeft: remaining(usage, "gemini_request"),
      webSearchLeft: remaining(usage, "web_search"),
      limits: BUDGET,
    },
  };
}
