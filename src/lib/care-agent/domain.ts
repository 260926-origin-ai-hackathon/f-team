// Pure domain logic for the care-support workflow: constants, budgets, question catalog,
// rule evaluation and the PII sanitize layer. No I/O here, so it is unit-testable.

export const APP_NAME = "care-support";
export const MODELS = {
  interview: "gemini-3.5-flash-lite",
  collection: "gemini-3.5-flash-lite",
  proposal: "gemini-3.5-flash",
  webSearch: "gemini-3.5-flash-lite",
  embedding: "gemini-embedding-2",
} as const;
export const EMBEDDING_DIMENSIONS = 768;

export const AGENT_NAMES = {
  interview: "care_interview_agent",
  collection: "information_collection_agent",
  proposal: "proposal_agent",
} as const;

// Per-case budgets (append-only ledger in case_usage).
export const BUDGET = {
  question: 5,
  proposal: 3,
  web_search: 1,
  gemini_request: 20,
  user_message: 15,
  toolCallsPerCollectionRun: 6,
  casesPerUserPerDay: 3,
} as const;
export type UsageKind = "gemini_request" | "tool_call" | "web_search" | "question" | "proposal" | "user_message";
export type UsageCounts = Record<UsageKind, number>;

export function emptyUsage(): UsageCounts {
  return { gemini_request: 0, tool_call: 0, web_search: 0, question: 0, proposal: 0, user_message: 0 };
}

export function remaining(usage: UsageCounts, kind: Exclude<UsageKind, "tool_call">) {
  return Math.max(0, BUDGET[kind] - usage[kind]);
}

// ---------------------------------------------------------------------------
// Care levels: 要支援1=0.1, 要支援2=0.2, 要介護1..5 = 1..5 (ordinal used by rules)
export function careLevelOrdinal(level: unknown): number | null {
  if (typeof level !== "string") return null;
  const support = level.match(/要支援\s*([12])/);
  if (support) return Number(support[1]) / 10;
  const care = level.match(/要介護\s*([1-5])/);
  if (care) return Number(care[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Question catalog: normalized questions with fixed choices (dynamic choice UI).
export type CatalogChoice = { value: string; label: string };
export type CatalogQuestion = {
  id: string;
  text: string;
  factKey: string;
  target: "fact" | "preference";
  holder?: "person" | "family";
  choices: CatalogChoice[];
};

export const QUESTION_CATALOG: CatalogQuestion[] = [
  {
    id: "certification_status",
    text: "要介護認定は受けていますか？",
    factKey: "certification_status",
    target: "fact",
    choices: [
      { value: "certified", label: "認定済み" },
      { value: "applying", label: "申請中" },
      { value: "not_applied", label: "未申請" },
      { value: "unknown", label: "分からない" },
    ],
  },
  {
    id: "family_available_time",
    text: "ご家族が介護に関われる時間帯はどれに近いですか？",
    factKey: "family_available_time",
    target: "fact",
    choices: [
      { value: "weekday_daytime", label: "平日の日中も関われる" },
      { value: "evenings_weekends", label: "平日夜・休日のみ" },
      { value: "rarely", label: "ほとんど難しい" },
      { value: "unknown", label: "分からない" },
    ],
  },
  {
    id: "desired_direction",
    text: "今後の暮らしについて、ご本人・ご家族の希望に近いものはどれですか？",
    factKey: "desired_direction",
    target: "preference",
    holder: "family",
    choices: [
      { value: "stay_home", label: "自宅で暮らし続けたい" },
      { value: "consider_facility", label: "施設入居も検討したい" },
      { value: "undecided", label: "まだ決めていない" },
    ],
  },
  {
    id: "bathing_support_frequency",
    text: "入浴の支援は、どのくらいの頻度で必要そうですか？",
    factKey: "bathing_support_frequency",
    target: "fact",
    choices: [
      { value: "weekly", label: "週1回程度" },
      { value: "two_three_weekly", label: "週2〜3回" },
      { value: "daily", label: "ほぼ毎日" },
      { value: "unknown", label: "分からない" },
    ],
  },
  {
    id: "person_acceptance",
    text: "ご本人は、介護サービスを増やすことに前向きですか？",
    factKey: "person_service_acceptance",
    target: "fact",
    choices: [
      { value: "positive", label: "前向き" },
      { value: "reluctant", label: "抵抗がありそう" },
      { value: "unknown", label: "分からない" },
    ],
  },
  {
    id: "cost_concern",
    text: "費用面で心配はありますか？",
    factKey: "cost_concern",
    target: "fact",
    choices: [
      { value: "high", label: "大きい" },
      { value: "some", label: "少しある" },
      { value: "none", label: "特にない" },
    ],
  },
];

export function findCatalogQuestion(id: string | undefined) {
  return QUESTION_CATALOG.find((q) => q.id === id);
}

// Life needs understood by need_service_mappings.
export const NEED_CODES = [
  "bathing_support",
  "daytime_supervision",
  "medication_support",
  "family_respite",
  "home_living",
  "dementia_care",
  "rehabilitation",
  "certification_needed",
  "consultation_entry",
  "care_plan_review",
  "cost_burden",
  "family_work_balance",
] as const;
export type NeedCode = (typeof NEED_CODES)[number];

// Needs about where to consult / which programs apply. Candidates for them are consultation windows
// (actions) and care/welfare programs, not only services.
export const CONSULTATION_NEEDS: readonly NeedCode[] = ["consultation_entry", "cost_burden", "family_work_balance", "care_plan_review", "certification_needed"];

export const SERVICE_CODES = ["S001", "S002", "S003", "S004", "S005", "S006", "S007", "S008", "S009", "S010", "S011", "S012", "S013"] as const;
export const ACTION_CODES = ["A001", "A002", "A003"] as const;
export const PROGRAM_CODES = ["P001", "P002", "P003", "P004", "P005"] as const;
/** Proposal categories: care services/facilities, consultation windows / procedures, care & welfare programs. */
export type TargetType = "service" | "action" | "program";
export const STAT_TABLE_CODES = ["K25-42", "K25-45", "K25-47", "K25-69", "K25-87", "C26-2", "C26-9", "C26-10", "S22-34", "S22-36", "S22-37", "S24-DEMO"] as const;

// ---------------------------------------------------------------------------
// Case data shapes
export type FactRow = { fact_key: string; value: unknown; value_status: "known" | "unknown"; source: string };
export type PreferenceRow = { preference_key: string; value: unknown; holder: "person" | "family"; source: string };
export type CaseIdentity = { display_name: string; address_detail: string | null; phone: string | null };

export type LlmCaseView = {
  note: string;
  facts: Record<string, unknown>;
  unknownFacts: string[];
  preferences: { key: string; holder: string; value: unknown }[];
  needs: string[];
};

// Keys that may never reach an LLM even if they end up in case_facts by mistake.
const BLOCKED_FACT_KEYS = new Set(["display_name", "name", "phone", "email", "address", "address_detail", "birth_date"]);

/**
 * Sanitized view of a case for Gemini: only case facts/preferences (city-level location at most),
 * never case_identities. Identity strings that leaked into free text are masked too.
 */
export function buildLlmCaseView(facts: FactRow[], preferences: PreferenceRow[], identity?: CaseIdentity | null): LlmCaseView {
  const mask = (value: unknown) => (typeof value === "string" ? maskIdentity(value, identity) : value);
  const known: Record<string, unknown> = {};
  const unknownFacts: string[] = [];
  const needs: string[] = [];
  for (const fact of facts) {
    if (BLOCKED_FACT_KEYS.has(fact.fact_key)) continue;
    if (fact.fact_key.startsWith("need:")) {
      if (fact.value === true) needs.push(fact.fact_key.slice(5));
      continue;
    }
    if (fact.value_status === "unknown") unknownFacts.push(fact.fact_key);
    else known[fact.fact_key] = mask(fact.value);
  }
  return {
    note: "登録済みの本人・家族情報（架空のデモデータ）。氏名・連絡先・詳細住所は含まない。",
    facts: known,
    unknownFacts,
    preferences: preferences.map((p) => ({ key: p.preference_key, holder: p.holder, value: mask(p.value) })),
    needs,
  };
}

const PHONE_PATTERN = /0\d{1,4}-?\d{1,4}-?\d{3,4}/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Masks direct identifiers in user-provided free text before it reaches ADK/Gemini. */
export function maskIdentity(text: string, identity?: CaseIdentity | null): string {
  let result = text.replace(EMAIL_PATTERN, "[メール]").replace(PHONE_PATTERN, "[電話番号]");
  const values = [identity?.display_name, identity?.address_detail, identity?.phone]
    .filter((v): v is string => typeof v === "string" && v.trim().length >= 2)
    .flatMap((v) => [v, v.replace(/（.*?）|\(.*?\)/g, "").trim()])
    .filter((v) => v.length >= 2);
  for (const value of new Set(values)) result = result.replaceAll(value, "[本人]");
  return result;
}

// ---------------------------------------------------------------------------
// Eligibility rules (A: institutional conditions), evaluated by code, not by the LLM.
export type EligibilityRule = {
  rule_id: string;
  target_service_code: string | null;
  target_action_code: string | null;
  condition: Record<string, unknown>;
  effect: "eligible" | "not_eligible_in_principle" | "requires_check" | "recommend_action";
  explanation: string;
  source: string;
  caveat: string;
  is_demo_rule: boolean;
};

export type RuleOutcome = {
  ruleId: string;
  target: { type: "service" | "action"; code: string };
  effect: EligibilityRule["effect"];
  explanation: string;
  caveat: string;
  source: string;
  isDemoRule: boolean;
};

export function evaluateRules(rules: EligibilityRule[], facts: Record<string, unknown>): RuleOutcome[] {
  const level = careLevelOrdinal(facts.care_level);
  const certification = typeof facts.certification_status === "string" ? facts.certification_status : "unknown";
  const outcomes: RuleOutcome[] = [];
  for (const rule of rules) {
    const c = rule.condition;
    let applies = false;
    if (c.always === true) applies = true;
    if (typeof c.care_level_below === "number") {
      // Unknown care level: do not hard-reject; surface as requires_check instead.
      applies = level === null ? false : level < c.care_level_below;
    }
    if (Array.isArray(c.certification_status_in)) applies = c.certification_status_in.includes(certification);
    if (!applies) continue;
    outcomes.push({
      ruleId: rule.rule_id,
      target: rule.target_service_code
        ? { type: "service", code: rule.target_service_code }
        : { type: "action", code: rule.target_action_code! },
      effect: rule.effect,
      explanation: rule.explanation,
      caveat: rule.caveat,
      source: rule.source,
      isDemoRule: rule.is_demo_rule,
    });
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Heuristic need detection from registered facts (used as fallback when Gemini is unavailable).
export function inferNeedsFromFacts(facts: Record<string, unknown>): NeedCode[] {
  const needs = new Set<NeedCode>();
  const text = (key: string) => (typeof facts[key] === "string" ? (facts[key] as string) : "");
  if (/介助|難し|できない/.test(text("bathing"))) needs.add("bathing_support");
  if (/支援|必要/.test(text("medication_management"))) needs.add("medication_support");
  if (/一人|独居/.test(text("household")) || /困難/.test(text("family_weekday_daytime"))) needs.add("daytime_supervision");
  if (/あり/.test(text("dementia"))) needs.add("dementia_care");
  if (["not_applied", "applying", "unknown"].includes(text("certification_status") || "unknown")) needs.add("certification_needed");
  if (["high", "some"].includes(text("cost_concern"))) needs.add("cost_burden");
  return [...needs];
}

// Guard against "statistics = recommendation" wording in model output.
const STAT_AS_RECOMMENDATION = /(統計|利用が多|多く利用|利用者が多|よく利用)[^。]{0,30}(ので|ため|から)[^。]{0,30}(べき|最適|おすすめ|推奨)/;
export function violatesStatPolicy(text: string) {
  return STAT_AS_RECOMMENDATION.test(text);
}
