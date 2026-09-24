"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { createCase, lastCase } from "./_care/client";
import { DemoNotice, primaryButton } from "./_care/ui";

export default function StartPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // localStorage is read on the client only; the server snapshot is null.
  const previous = useSyncExternalStore(
    () => () => {},
    () => lastCase(),
    () => null,
  );

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const caseId = await createCase();
      router.push(`/consult/${caseId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "相談を開始できませんでした。");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh justify-center bg-gradient-to-b from-white to-emerald-50">
      <div className="flex w-full max-w-md flex-col px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-10">
        <main className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-emerald-600 shadow-lg shadow-emerald-600/20">
            <svg viewBox="0 0 24 24" className="h-10 w-10 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path d="M4 5h16v10H9l-5 4V5Z" strokeLinejoin="round" />
              <path d="M12 12s-2.5-1.5-2.5-3.2A1.4 1.4 0 0 1 12 8a1.4 1.4 0 0 1 2.5.8C14.5 10.5 12 12 12 12Z" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">介護の相談AI</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-600">
            ご本人とご家族の状況をAIに話すだけで、
            <br />
            いま検討すべきことや、候補になるサービス・相談先が分かり、
            <br />
            次の行動まで進められます。
          </p>
          <div className="mt-6 w-full rounded-2xl border border-emerald-100 bg-white p-4 text-left text-sm text-gray-700">
            <p className="font-bold text-emerald-800">デモ利用者A（架空）の登録情報を使って相談します</p>
            <p className="mt-1 text-xs text-gray-500">82歳・女性・大阪府吹田市・要介護2 など、すでに登録されている架空の情報をAIが参照します。</p>
          </div>
        </main>
        <footer className="space-y-3">
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button type="button" onClick={start} disabled={busy} className={`${primaryButton} w-full`}>
            {busy ? "準備しています…" : "相談をはじめる"}
          </button>
          {previous && (
            <Link href={`/consult/${previous}`} className="block text-center text-sm font-semibold text-emerald-700">
              前回の相談を続ける
            </Link>
          )}
          <DemoNotice />
        </footer>
      </div>
    </div>
  );
}
