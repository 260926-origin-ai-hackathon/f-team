"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Technical spike only (S0–S9). Removed once the real care workflow is built.
export default function SpikePage() {
  const [uid, setUid] = useState<string>("");
  const [sessionId, setSessionId] = useState("");
  const [interruptId, setInterruptId] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInAnonymously();
    setUid(error ? `error: ${error.message}` : (data.user?.id ?? ""));
  }

  async function call(action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      const res = await fetch("/api/spike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId, interruptId, ...extra }),
      });
      const data = await res.json();
      if (data.sessionId && action !== "read") setSessionId(data.sessionId);
      if (data.interruptId) setInterruptId(data.interruptId);
      setResult(JSON.stringify({ status: res.status, ...data }, null, 2));
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50";
  return (
    <main className="mx-auto max-w-md space-y-3 p-4 text-sm text-gray-800">
      <h1 className="text-lg font-bold">ADK Technical Spike</h1>
      <p>uid: <span id="uid">{uid || "(未ログイン)"}</span></p>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={signIn} disabled={busy}>匿名ログイン</button>
        <button className={button} onClick={() => call("start", { message: "デモ利用者A（電話 090-0000-0000）が一人でお風呂に入れなくなりました。" })} disabled={busy}>start</button>
        <button className={button} onClick={() => call("resume", { reply: "平日の昼間は家族がいません。" })} disabled={busy}>resume</button>
        <button className={button} onClick={() => call("read")} disabled={busy}>read</button>
        <button className={button} onClick={() => call("tools")} disabled={busy}>tools</button>
      </div>
      <label className="block">
        sessionId
        <input id="sessionId" className="mt-1 w-full rounded border p-2 font-mono text-xs" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
      </label>
      <label className="block">
        interruptId
        <input id="interruptId" className="mt-1 w-full rounded border p-2 font-mono text-xs" value={interruptId} onChange={(e) => setInterruptId(e.target.value)} />
      </label>
      <pre id="result" className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2 text-xs">{busy ? "running…" : result}</pre>
    </main>
  );
}
