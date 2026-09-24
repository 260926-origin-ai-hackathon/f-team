import { REQUEST_INPUT_FUNCTION_CALL_NAME, Runner, type Event } from "@google/adk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSessionService } from "@/lib/adk/supabase-session-service";
import { APP_NAME, BUDGET, maskIdentity } from "./domain";
import { CareGuardPlugin } from "./agents";
import { getCase, getIdentity, getUsage, listProposals, logEvent, recordUsage, saveMessage, updateCase } from "./repo";
import type { Fault } from "./tools";
import { NODE_PROGRESS, createCareWorkflow, type ClientReply } from "./workflow";

export type TurnEvent =
  | { type: "progress"; label: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

const ALLOWED_FAULTS: Fault[] = ["gemini", "db", "web", "providers_empty"];

/** Fault injection is honoured only outside Production and only when explicitly enabled. */
export function parseFaults(header: string | null): Set<Fault> {
  if (process.env.FAULT_INJECTION_ENABLED !== "1" || process.env.VERCEL_ENV === "production" || !header) return new Set();
  return new Set(header.split(",").map((s) => s.trim()).filter((s): s is Fault => ALLOWED_FAULTS.includes(s as Fault)));
}

async function userVisibleText(sb: SupabaseClient, caseId: string, reply: ClientReply) {
  switch (reply.type) {
    case "message":
      return reply.text;
    case "catalog_answer":
      return reply.label;
    case "request_proposal":
      return "今ある情報で提案してください";
    case "accept": {
      const proposal = (await listProposals(sb, caseId)).find((p) => p.id === reply.proposalId);
      return proposal ? `「${proposal.title}」を進めます` : "この提案を進めます";
    }
    case "consult_more":
      return reply.text?.trim() || "他の案も相談したいです";
    case "select_provider":
      return reply.providerId ? "この事業所に問い合わせます" : "事業所はあとで決めます";
  }
}

/** Sanitized copy of the reply that is handed to ADK (and therefore stored in adk_events). */
function sanitizeReply(reply: ClientReply, identity: Parameters<typeof maskIdentity>[1]): ClientReply {
  if (reply.type === "message") return { type: "message", text: maskIdentity(reply.text, identity).slice(0, 1000) };
  if (reply.type === "consult_more") return { type: "consult_more", text: reply.text ? maskIdentity(reply.text, identity).slice(0, 1000) : undefined };
  return reply;
}

/** Latest adk_request_input call that has no matching function response yet (a paused RequestInput). */
export function pendingInterruptId(events: Event[]): string | undefined {
  const answered = new Set<string>();
  let pending: string | undefined;
  for (const event of events) {
    for (const part of event.content?.parts ?? []) {
      if (part.functionResponse?.name === REQUEST_INPUT_FUNCTION_CALL_NAME && part.functionResponse.id) answered.add(part.functionResponse.id);
      if (part.functionCall?.name === REQUEST_INPUT_FUNCTION_CALL_NAME && part.functionCall.id) pending = part.functionCall.id;
    }
  }
  return pending && !answered.has(pending) ? pending : undefined;
}

function progressLabel(event: Event) {
  const path = event.nodeInfo?.path ?? event.author ?? "";
  const nodeName = path.split(".").pop() ?? "";
  return NODE_PROGRESS[nodeName];
}

export async function* runTurn(
  sb: SupabaseClient,
  userId: string,
  caseId: string,
  reply: ClientReply,
  clientMessageId: string,
  faults: ReadonlySet<Fault>,
): AsyncGenerator<TurnEvent> {
  const careCase = await getCase(sb, caseId);
  if (!careCase) {
    yield { type: "error", message: "相談が見つかりません。" };
    return;
  }
  const usage = await getUsage(sb, caseId);
  if (usage.user_message >= BUDGET.user_message) {
    yield { type: "notice", message: "このデモでは1つの相談で送信できるのは15回までです。新しい相談を始めてください。" };
    return;
  }

  const identity = await getIdentity(sb, caseId);
  const text = await userVisibleText(sb, caseId, reply);
  await saveMessage(
    sb,
    caseId,
    { role: "user", kind: reply.type === "message" || reply.type === "consult_more" ? "text" : "answer", content: text, payload: { reply } },
    `client:${clientMessageId}`,
  );
  await recordUsage(sb, caseId, "user_message", reply.type);

  const sessionService = new SupabaseSessionService(sb);
  let sessionId = careCase.adk_session_id;
  if (!sessionId) {
    const session = await sessionService.createSession({ appName: APP_NAME, userId });
    sessionId = session.id;
    await sb.from("adk_sessions").update({ case_id: caseId }).eq("id", sessionId);
    await updateCase(sb, caseId, { adk_session_id: sessionId });
  }

  const plugin = new CareGuardPlugin(sb, caseId, faults);
  const workflow = createCareWorkflow({ sb, caseId, cityCode: careCase.location_city_code, faults, plugin });
  const runner = new Runner({ appName: APP_NAME, agent: workflow, sessionService, plugins: [plugin] });

  let lastLabel: string | undefined;
  try {
    // Only the sanitized reply reaches ADK. A paused RequestInput is resumed with a function response
    // carrying its interrupt id (verified in the spike); otherwise the workflow starts from START.
    const payload = JSON.stringify(sanitizeReply(reply, identity));
    const session = await sessionService.getSession({ appName: APP_NAME, userId, sessionId });
    const interruptId = session ? pendingInterruptId(session.events) : undefined;
    const events = runner.runAsync({
      userId,
      sessionId,
      newMessage: interruptId
        ? {
            role: "user",
            parts: [{ functionResponse: { id: interruptId, name: REQUEST_INPUT_FUNCTION_CALL_NAME, response: { result: payload } } }],
          }
        : { role: "user", parts: [{ text: payload }] },
    });
    for await (const event of events) {
      const label = progressLabel(event);
      if (label && label !== lastLabel) {
        lastLabel = label;
        yield { type: "progress", label };
      }
    }
  } catch (error) {
    console.error("care workflow failed", error);
    await saveMessage(
      sb,
      caseId,
      { role: "assistant", kind: "notice", content: "処理中に問題が発生しました。少し時間をおいて、もう一度送信してください。" },
      `error:${clientMessageId}`,
    ).catch(() => undefined);
    await logEvent(sb, "workflow_error", caseId, { message: error instanceof Error ? error.message : String(error) });
    yield { type: "error", message: "処理中に問題が発生しました。もう一度お試しください。" };
  }
  yield { type: "done" };
}
