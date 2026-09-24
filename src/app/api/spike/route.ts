import { NextResponse } from "next/server";
import { REQUEST_INPUT_FUNCTION_CALL_NAME, Runner, type Event } from "@google/adk";
import { createClient } from "@/lib/supabase/server";
import { SupabaseSessionService } from "@/lib/adk/supabase-session-service";
import { createSpikeToolWorkflow, spikeWorkflow } from "@/lib/adk/spike-workflow";

// Technical spike only (S0–S9). Removed once the real care workflow is built.
export const runtime = "nodejs";
export const maxDuration = 60;

const APP_NAME = "care-spike";
// Identifies the serverless instance, to show pause and resume ran in separate requests/instances.
const INSTANCE_ID = crypto.randomUUID();
// Fictional identity values the sanitizer must strip before anything reaches ADK (S7).
const DEMO_IDENTITIES = ["デモ利用者A", "090-0000-0000"];

function sanitizeForLlm(text: string) {
  return DEMO_IDENTITIES.reduce((acc, value, i) => acc.replaceAll(value, `[ID_${i + 1}]`), text);
}

function summarize(events: Event[]) {
  let interruptId: string | undefined;
  const summary = events.map((event) => {
    const parts = event.content?.parts ?? [];
    for (const part of parts) {
      if (part.functionCall?.name === REQUEST_INPUT_FUNCTION_CALL_NAME) interruptId = part.functionCall.id;
    }
    return {
      author: event.author,
      node: event.nodeInfo?.path,
      text: parts.map((p) => p.text).filter(Boolean).join("") || undefined,
      functionCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall?.name),
      output: event.output,
      error: event.errorCode ? `${event.errorCode}: ${event.errorMessage}` : undefined,
    };
  });
  return { interruptId, events: summary };
}

async function collect(iterator: AsyncGenerator<Event, void, undefined>) {
  const events: Event[] = [];
  for await (const event of iterator) events.push(event);
  return events;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
  const sessionService = new SupabaseSessionService(supabase);
  const meta = {
    uid: user.id,
    isAnonymous: user.is_anonymous ?? false,
    instanceId: INSTANCE_ID,
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    // Presence only; values are never returned or logged.
    keyPresence: {
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      GOOGLE_GENAI_API_KEY: Boolean(process.env.GOOGLE_GENAI_API_KEY),
      GOOGLE_API_KEY: Boolean(process.env.GOOGLE_API_KEY),
    },
  };

  try {
    switch (body.action) {
      case "start": {
        const runner = new Runner({ appName: APP_NAME, agent: spikeWorkflow, sessionService });
        const session = await sessionService.createSession({ appName: APP_NAME, userId: user.id });
        const text = sanitizeForLlm(body.message ?? "母がお風呂に入るのが難しくなりました。");
        const events = await collect(
          runner.runAsync({ userId: user.id, sessionId: session.id, newMessage: { role: "user", parts: [{ text }] } }),
        );
        return NextResponse.json({ ...meta, sessionId: session.id, sanitizedInput: text, ...summarize(events) });
      }
      case "resume": {
        if (!body.sessionId || !body.interruptId) throw new Error("sessionId and interruptId are required");
        const runner = new Runner({ appName: APP_NAME, agent: spikeWorkflow, sessionService });
        const reply = sanitizeForLlm(body.reply ?? "平日の昼間は家族がいません。");
        const events = await collect(
          runner.runAsync({
            userId: user.id,
            sessionId: body.sessionId,
            newMessage: {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    id: body.interruptId,
                    name: REQUEST_INPUT_FUNCTION_CALL_NAME,
                    response: { result: reply },
                  },
                },
              ],
            },
          }),
        );
        return NextResponse.json({ ...meta, sessionId: body.sessionId, ...summarize(events) });
      }
      case "read": {
        if (!body.sessionId) throw new Error("sessionId is required");
        // Reads another user's session id too: RLS must hide it (S6).
        const { data: sessionRows, error: sErr } = await supabase
          .from("adk_sessions")
          .select("id, user_id")
          .eq("id", body.sessionId);
        const { data: eventRows, error: eErr } = await supabase
          .from("adk_events")
          .select("event_json")
          .eq("session_id", body.sessionId);
        if (sErr || eErr) throw new Error((sErr ?? eErr)!.message);
        const serialized = JSON.stringify(eventRows ?? []);
        return NextResponse.json({
          ...meta,
          sessionVisible: (sessionRows ?? []).length > 0,
          sessionOwnedByCaller: sessionRows?.[0]?.user_id === user.id,
          eventCount: (eventRows ?? []).length,
          // S7: raw identity values must not appear in stored ADK events.
          identityLeak: DEMO_IDENTITIES.filter((value) => serialized.includes(value)),
          sanitizedPlaceholdersFound: serialized.includes("[ID_1]"),
        });
      }
      case "tools": {
        let modelRequests = 0;
        const workflow = createSpikeToolWorkflow(() => {
          modelRequests += 1;
        });
        const runner = new Runner({ appName: APP_NAME, agent: workflow, sessionService });
        const session = await sessionService.createSession({ appName: APP_NAME, userId: user.id });
        const events = await collect(
          runner.runAsync({
            userId: user.id,
            sessionId: session.id,
            newMessage: { role: "user", parts: [{ text: "訪問介護のコードを教えてください" }] },
          }),
        );
        return NextResponse.json({ ...meta, sessionId: session.id, modelRequests, ...summarize(events) });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("spike error", error);
    return NextResponse.json(
      { ...meta, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
