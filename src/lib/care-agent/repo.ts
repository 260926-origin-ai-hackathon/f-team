import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUDGET,
  emptyUsage,
  type CaseIdentity,
  type EligibilityRule,
  type FactRow,
  type PreferenceRow,
  type UsageCounts,
  type UsageKind,
} from "./domain";

// All reads/writes run with the caller's authenticated client, so RLS (owner_id = auth.uid()) applies.
// Writes are idempotent: INSERT ... ON CONFLICT DO NOTHING on (case_id|run_id, idempotency_key).

export class RepoError extends Error {}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new RepoError(`${what}: ${result.error.message}`);
  return result.data;
}

export const TEMPLATE_KEY = "demo_case_001";

export type CaseRow = {
  id: string;
  status: string;
  adk_session_id: string | null;
  location_city_code: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  content: string;
  payload: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Usage ledger

export async function getUsage(sb: SupabaseClient, caseId: string): Promise<UsageCounts> {
  const rows = check(await sb.from("case_usage").select("kind").eq("case_id", caseId), "getUsage") as { kind: UsageKind }[];
  const usage = emptyUsage();
  for (const row of rows ?? []) usage[row.kind] += 1;
  return usage;
}

export async function recordUsage(sb: SupabaseClient, caseId: string, kind: UsageKind, detail?: string) {
  check(await sb.from("case_usage").insert({ case_id: caseId, kind, detail: detail ?? null }), "recordUsage");
}

// ---------------------------------------------------------------------------
// Cases

export async function countCasesCreatedToday(sb: SupabaseClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await sb
    .from("app_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "case_created")
    .gte("created_at", since);
  if (error) throw new RepoError(`countCasesCreatedToday: ${error.message}`);
  return count ?? 0;
}

export class CaseLimitError extends Error {}

/** Clones the demo template (identity, facts, preferences) into a new case owned by the caller. */
export async function createCaseFromTemplate(sb: SupabaseClient): Promise<string> {
  if ((await countCasesCreatedToday(sb)) >= BUDGET.casesPerUserPerDay) {
    throw new CaseLimitError("本日作成できる相談の上限に達しました。");
  }
  const template = check(
    await sb.from("care_cases").select("id, location_city_code").eq("template_key", TEMPLATE_KEY).single(),
    "load template",
  ) as { id: string; location_city_code: string | null };

  const created = check(
    await sb
      .from("care_cases")
      .insert({ source_template_id: template.id, location_city_code: template.location_city_code, status: "interviewing" })
      .select("id")
      .single(),
    "create case",
  ) as { id: string };
  const caseId = created.id;

  const identity = check(
    await sb.from("case_identities").select("display_name, address_detail, phone").eq("case_id", template.id).single(),
    "load template identity",
  ) as CaseIdentity;
  check(await sb.from("case_identities").insert({ case_id: caseId, ...identity }), "clone identity");

  const facts = check(
    await sb.from("case_facts_current").select("fact_key, value, value_status, source").eq("case_id", template.id),
    "load template facts",
  ) as FactRow[];
  if (facts.length) {
    check(
      await sb.from("case_facts").insert(
        facts.map((f) => ({
          case_id: caseId,
          fact_key: f.fact_key,
          value: f.value,
          value_status: f.value_status,
          source: "registered_profile",
          idempotency_key: `clone:${f.fact_key}`,
        })),
      ),
      "clone facts",
    );
  }

  const prefs = check(
    await sb.from("case_preferences_current").select("preference_key, value, holder, source").eq("case_id", template.id),
    "load template preferences",
  ) as PreferenceRow[];
  if (prefs.length) {
    check(
      await sb.from("case_preferences").insert(
        prefs.map((p) => ({
          case_id: caseId,
          preference_key: p.preference_key,
          value: p.value,
          holder: p.holder,
          source: "registered_profile",
          idempotency_key: `clone:${p.preference_key}`,
        })),
      ),
      "clone preferences",
    );
  }

  await logEvent(sb, "case_created", caseId, { template: TEMPLATE_KEY });
  return caseId;
}

export async function getCase(sb: SupabaseClient, caseId: string): Promise<CaseRow | null> {
  return check(
    await sb.from("care_cases").select("id, status, adk_session_id, location_city_code, created_at").eq("id", caseId).maybeSingle(),
    "getCase",
  ) as CaseRow | null;
}

export async function updateCase(sb: SupabaseClient, caseId: string, patch: Partial<Pick<CaseRow, "status" | "adk_session_id">>) {
  check(await sb.from("care_cases").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", caseId), "updateCase");
}

export async function getIdentity(sb: SupabaseClient, caseId: string): Promise<CaseIdentity | null> {
  return check(
    await sb.from("case_identities").select("display_name, address_detail, phone").eq("case_id", caseId).maybeSingle(),
    "getIdentity",
  ) as CaseIdentity | null;
}

export async function getCurrentFacts(sb: SupabaseClient, caseId: string): Promise<FactRow[]> {
  return check(
    await sb.from("case_facts_current").select("fact_key, value, value_status, source").eq("case_id", caseId),
    "getCurrentFacts",
  ) as FactRow[];
}

export async function getCurrentPreferences(sb: SupabaseClient, caseId: string): Promise<PreferenceRow[]> {
  return check(
    await sb.from("case_preferences_current").select("preference_key, value, holder, source").eq("case_id", caseId),
    "getCurrentPreferences",
  ) as PreferenceRow[];
}

export type FactInput = {
  key: string;
  value: unknown;
  status?: "known" | "unknown";
  source: "catalog_answer" | "user_message" | "agent_inferred";
  confidence?: number;
};

export async function saveFacts(sb: SupabaseClient, caseId: string, facts: FactInput[], idemPrefix: string) {
  if (!facts.length) return;
  check(
    await sb.from("case_facts").upsert(
      facts.map((f) => ({
        case_id: caseId,
        fact_key: f.key,
        value: f.value ?? null,
        value_status: f.status ?? "known",
        source: f.source,
        confidence: f.confidence ?? null,
        idempotency_key: `${idemPrefix}:${f.key}`,
      })),
      { onConflict: "case_id,idempotency_key", ignoreDuplicates: true },
    ),
    "saveFacts",
  );
}

export async function savePreferences(
  sb: SupabaseClient,
  caseId: string,
  prefs: { key: string; value: unknown; holder: "person" | "family"; source: FactInput["source"] }[],
  idemPrefix: string,
) {
  if (!prefs.length) return;
  check(
    await sb.from("case_preferences").upsert(
      prefs.map((p) => ({
        case_id: caseId,
        preference_key: p.key,
        value: p.value,
        holder: p.holder,
        source: p.source,
        idempotency_key: `${idemPrefix}:${p.key}`,
      })),
      { onConflict: "case_id,idempotency_key", ignoreDuplicates: true },
    ),
    "savePreferences",
  );
}

// ---------------------------------------------------------------------------
// Messages

export async function saveMessage(
  sb: SupabaseClient,
  caseId: string,
  message: { role: MessageRow["role"]; kind: string; content: string; payload?: Record<string, unknown> },
  idempotencyKey: string,
) {
  check(
    await sb
      .from("care_messages")
      .upsert(
        { case_id: caseId, ...message, payload: message.payload ?? {}, idempotency_key: idempotencyKey },
        { onConflict: "case_id,idempotency_key", ignoreDuplicates: true },
      ),
    "saveMessage",
  );
}

export async function listMessages(sb: SupabaseClient, caseId: string, limit = 200): Promise<MessageRow[]> {
  return check(
    await sb
      .from("care_messages")
      .select("id, role, kind, content, payload, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true })
      .limit(limit),
    "listMessages",
  ) as MessageRow[];
}

// ---------------------------------------------------------------------------
// Proposal runs, typed tool results (source of truth), proposals

export type ProposalRunRow = { id: string; round: number; status: string; agent2_control: unknown };

export async function ensureProposalRun(sb: SupabaseClient, caseId: string, round: number): Promise<ProposalRunRow> {
  check(
    await sb.from("proposal_runs").upsert({ case_id: caseId, round }, { onConflict: "case_id,round", ignoreDuplicates: true }),
    "ensureProposalRun",
  );
  return check(
    await sb.from("proposal_runs").select("id, round, status, agent2_control").eq("case_id", caseId).eq("round", round).single(),
    "load proposal run",
  ) as ProposalRunRow;
}

export async function listProposalRuns(sb: SupabaseClient, caseId: string): Promise<ProposalRunRow[]> {
  return check(
    await sb.from("proposal_runs").select("id, round, status, agent2_control").eq("case_id", caseId).order("round"),
    "listProposalRuns",
  ) as ProposalRunRow[];
}

export async function updateProposalRun(sb: SupabaseClient, runId: string, patch: { status?: string; agent2_control?: unknown; summary?: string }) {
  check(await sb.from("proposal_runs").update(patch).eq("id", runId), "updateProposalRun");
}

export type SourceRow = {
  id: string;
  run_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "ok" | "empty" | "error" | "skipped";
  created_at: string;
};

export async function saveToolResult(
  sb: SupabaseClient,
  caseId: string,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  status: SourceRow["status"],
  idempotencyKey: string,
) {
  check(
    await sb.from("proposal_sources").upsert(
      { run_id: runId, case_id: caseId, tool_name: toolName, tool_args: args, result, status, idempotency_key: idempotencyKey },
      { onConflict: "run_id,idempotency_key", ignoreDuplicates: true },
    ),
    "saveToolResult",
  );
}

export async function listToolResults(sb: SupabaseClient, runIds: string[]): Promise<SourceRow[]> {
  if (!runIds.length) return [];
  return check(
    await sb
      .from("proposal_sources")
      .select("id, run_id, tool_name, tool_args, result, status, created_at")
      .in("run_id", runIds)
      .order("created_at"),
    "listToolResults",
  ) as SourceRow[];
}

export type ProposalRow = {
  id: string;
  run_id: string;
  rank: number;
  target_type: "service" | "action";
  target_code: string;
  title: string;
  content: Record<string, unknown>;
  decision: "accepted" | "declined" | null;
};

export async function saveProposals(
  sb: SupabaseClient,
  caseId: string,
  runId: string,
  proposals: Omit<ProposalRow, "id" | "run_id" | "decision">[],
) {
  check(
    await sb.from("proposals").upsert(
      proposals.map((p) => ({ ...p, run_id: runId, case_id: caseId })),
      { onConflict: "run_id,rank", ignoreDuplicates: true },
    ),
    "saveProposals",
  );
}

export async function listProposals(sb: SupabaseClient, caseId: string, runId?: string): Promise<ProposalRow[]> {
  let query = sb
    .from("proposals")
    .select("id, run_id, rank, target_type, target_code, title, content, decision")
    .eq("case_id", caseId)
    .order("rank");
  if (runId) query = query.eq("run_id", runId);
  return check(await query, "listProposals") as ProposalRow[];
}

export async function decideProposal(sb: SupabaseClient, proposalId: string, decision: "accepted" | "declined") {
  check(
    await sb.from("proposals").update({ decision, decided_at: new Date().toISOString() }).eq("id", proposalId).is("decision", null),
    "decideProposal",
  );
}

// ---------------------------------------------------------------------------
// Reference data (read-only)

export async function getEligibilityRules(sb: SupabaseClient): Promise<EligibilityRule[]> {
  return check(await sb.from("eligibility_rules").select("*"), "getEligibilityRules") as EligibilityRule[];
}

export type NeedMappingRow = {
  need_code: string;
  need_label: string;
  service_code: string | null;
  action_code: string | null;
  strength: "primary" | "secondary";
  rationale: string;
};

export async function getNeedMappings(sb: SupabaseClient, needCodes: string[]): Promise<NeedMappingRow[]> {
  if (!needCodes.length) return [];
  return check(
    await sb.from("need_service_mappings").select("need_code, need_label, service_code, action_code, strength, rationale").in("need_code", needCodes),
    "getNeedMappings",
  ) as NeedMappingRow[];
}

export async function getServicesAndActions(sb: SupabaseClient) {
  const services = check(await sb.from("care_services").select("code, name, category, description"), "services") as {
    code: string;
    name: string;
    category: string;
    description: string;
  }[];
  const actions = check(await sb.from("care_actions").select("code, name, action_type, description"), "actions") as {
    code: string;
    name: string;
    action_type: string;
    description: string;
  }[];
  return { services, actions };
}

export type TaskTemplateRow = {
  id: string;
  target_type: "service" | "action";
  target_code: string;
  title: string;
  steps: { step_id: string; title: string; detail: string; requires_official_check: boolean }[];
  caveat: string;
};

export async function getTaskTemplate(sb: SupabaseClient, targetType: "service" | "action", targetCode: string): Promise<TaskTemplateRow | null> {
  const exact = check(
    await sb.from("task_templates").select("*").eq("target_type", targetType).eq("target_code", targetCode).maybeSingle(),
    "getTaskTemplate",
  ) as TaskTemplateRow | null;
  if (exact || targetType === "action") return exact;
  return check(await sb.from("task_templates").select("*").eq("id", "T-GENERIC").maybeSingle(), "generic template") as TaskTemplateRow | null;
}

// ---------------------------------------------------------------------------
// Tasks (status changes happen outside the ADK workflow)

export type TaskRow = {
  id: string;
  proposal_id: string | null;
  template_id: string | null;
  provider_id: string | null;
  step_id: string;
  title: string;
  detail: string | null;
  requires_official_check: boolean;
  status: "todo" | "in_progress" | "done";
  sort_order: number;
};

export async function createTasks(
  sb: SupabaseClient,
  caseId: string,
  tasks: Omit<TaskRow, "id" | "status">[],
  idemPrefix: string,
) {
  if (!tasks.length) return;
  check(
    await sb.from("case_tasks").upsert(
      tasks.map((t) => ({ ...t, case_id: caseId, idempotency_key: `${idemPrefix}:${t.step_id}` })),
      { onConflict: "case_id,idempotency_key", ignoreDuplicates: true },
    ),
    "createTasks",
  );
}

export async function listTasks(sb: SupabaseClient, caseId: string): Promise<TaskRow[]> {
  return check(
    await sb
      .from("case_tasks")
      .select("id, proposal_id, template_id, provider_id, step_id, title, detail, requires_official_check, status, sort_order")
      .eq("case_id", caseId)
      .order("sort_order"),
    "listTasks",
  ) as TaskRow[];
}

export async function updateTaskStatus(sb: SupabaseClient, taskId: string, status: TaskRow["status"]) {
  const task = check(
    await sb.from("case_tasks").select("id, case_id, status").eq("id", taskId).maybeSingle(),
    "load task",
  ) as { id: string; case_id: string; status: string } | null;
  if (!task) return null;
  if (task.status === status) return task;
  check(await sb.from("case_tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", taskId), "update task");
  check(
    await sb.from("task_events").insert({ task_id: taskId, case_id: task.case_id, from_status: task.status, to_status: status }),
    "task event",
  );
  return { ...task, status };
}

// ---------------------------------------------------------------------------
// Analytics

export async function logEvent(sb: SupabaseClient, eventType: string, caseId: string | null, payload: Record<string, unknown> = {}) {
  // Analytics must never break the product flow.
  const { error } = await sb.from("app_events").insert({ event_type: eventType, case_id: caseId, payload });
  if (error) console.warn(`logEvent ${eventType} failed: ${error.message}`);
}
