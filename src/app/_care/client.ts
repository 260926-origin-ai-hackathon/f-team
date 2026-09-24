"use client";

import { createClient } from "@/lib/supabase/client";
import type { CaseViewModel } from "@/lib/care-agent/view";
import type { ClientReply } from "@/lib/care-agent/workflow";

export type CaseView = NonNullable<CaseViewModel>;

const LAST_CASE_KEY = "care-demo:last-case";

/** Signs in anonymously (no login screen) when there is no session yet. */
export async function ensureAnonymousSession() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) return data.user.id;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signedIn.user) throw new Error("匿名セッションを開始できませんでした。");
  return signedIn.user.id;
}

export function rememberCase(caseId: string) {
  try {
    localStorage.setItem(LAST_CASE_KEY, caseId);
  } catch {}
}

export function lastCase() {
  try {
    return localStorage.getItem(LAST_CASE_KEY);
  } catch {
    return null;
  }
}

export async function createCase(): Promise<string> {
  await ensureAnonymousSession();
  const res = await fetch("/api/cases", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "相談を開始できませんでした。");
  rememberCase(data.caseId);
  return data.caseId;
}

export async function fetchCase(caseId: string): Promise<CaseView> {
  await ensureAnonymousSession();
  const res = await fetch(`/api/cases/${caseId}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "相談を読み込めませんでした。");
  return data as CaseView;
}

export type TurnStreamEvent =
  | { type: "progress"; label: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** Sends one turn and reads Server-Sent Events until the workflow pauses or ends. */
export async function sendTurn(caseId: string, reply: ClientReply, onEvent: (event: TurnStreamEvent) => void, fault?: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (fault) headers["x-demo-fault"] = fault;
  const res = await fetch(`/api/cases/${caseId}/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reply, clientMessageId: crypto.randomUUID() }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: data.error ?? "送信できませんでした。" });
    onEvent({ type: "done" });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as TurnStreamEvent);
    }
  }
}

export async function updateTask(taskId: string, status: "todo" | "in_progress" | "done") {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "更新できませんでした。");
}
