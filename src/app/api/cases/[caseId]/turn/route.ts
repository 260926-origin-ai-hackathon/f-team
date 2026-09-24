import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseFaults, runTurn } from "@/lib/care-agent/turn";
import type { ClientReply } from "@/lib/care-agent/workflow";

export const runtime = "nodejs";
export const maxDuration = 300;

const REPLY_TYPES = new Set(["message", "catalog_answer", "request_proposal", "accept", "consult_more", "select_provider"]);

function isReply(value: unknown): value is ClientReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  if (!REPLY_TYPES.has(String(reply.type))) return false;
  if (reply.type === "message") return typeof reply.text === "string" && reply.text.trim().length > 0 && reply.text.length <= 1000;
  if (reply.type === "catalog_answer") return typeof reply.questionId === "string" && typeof reply.value === "string";
  if (reply.type === "accept") return typeof reply.proposalId === "string";
  return true;
}

// Runs one consultation turn through the ADK workflow and streams progress as Server-Sent Events.
export async function POST(request: Request, { params }: RouteContext<"/api/cases/[caseId]/turn">) {
  const { caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { reply?: unknown; clientMessageId?: unknown } | null;
  if (!body || !isReply(body.reply) || typeof body.clientMessageId !== "string") {
    return NextResponse.json({ error: "入力内容が正しくありません。" }, { status: 400 });
  }
  const reply = body.reply;
  const clientMessageId = body.clientMessageId.slice(0, 64);
  const faults = parseFaults(request.headers.get("x-demo-fault"));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const event of runTurn(supabase, user.id, caseId, reply, clientMessageId, faults)) send(event);
      } catch (error) {
        console.error("turn failed", error);
        send({ type: "error", message: "処理中に問題が発生しました。もう一度お試しください。" });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
