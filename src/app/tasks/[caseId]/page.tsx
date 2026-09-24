"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchCase, updateTask, type CaseView } from "../../_care/client";
import { DemoNotice, Spinner } from "../../_care/ui";

const STATUS_LABELS = { todo: "未着手", in_progress: "進行中", done: "完了" } as const;
type Status = keyof typeof STATUS_LABELS;

export default function TasksPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [view, setView] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCase(caseId)
      .then((v) => active && setView(v))
      .catch((e) => active && setError(e instanceof Error ? e.message : "読み込めませんでした。"));
    return () => {
      active = false;
    };
  }, [caseId]);

  async function change(taskId: string, status: Status) {
    setSaving(taskId);
    setError(null);
    try {
      await updateTask(taskId, status);
      setView((v) => (v ? { ...v, tasks: v.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) } : v));
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新できませんでした。");
    } finally {
      setSaving(null);
    }
  }

  const accepted = view?.runs.flatMap((r) => r.proposals).filter((p) => p.decision === "accepted") ?? [];
  const done = view?.tasks.filter((t) => t.status === "done").length ?? 0;

  return (
    <div className="flex min-h-dvh justify-center bg-[#F6FAF7] text-gray-800">
      <div className="w-full max-w-2xl px-4 pb-10 pt-[max(env(safe-area-inset-top),1rem)]">
        <header className="mb-4 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold text-emerald-700">介護タスク</p>
            <h1 className="text-lg font-bold">これからやること</h1>
          </div>
          <Link href={`/consult/${caseId}`} className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800">
            相談に戻る
          </Link>
        </header>

        {!view && !error && <Spinner label="読み込んでいます" />}
        {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {view && (
          <>
            {accepted.map((p) => (
              <p key={p.id} className="mb-3 rounded-2xl bg-white p-3 text-sm shadow-sm">
                <span className="text-xs text-gray-500">進める提案：</span>
                <span className="font-bold">{p.title}</span>
              </p>
            ))}
            <p className="mb-2 text-xs text-gray-500">
              完了 {done} / {view.tasks.length}
            </p>
            {view.tasks.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">まだタスクはありません。相談画面で提案を選ぶと作成されます。</p>}
            <ul className="space-y-2">
              {view.tasks.map((t) => (
                <li key={t.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${t.status === "done" ? "border-emerald-200 opacity-80" : "border-gray-100"}`}>
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-xs ${
                        t.status === "done" ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300"
                      }`}
                    >
                      {t.status === "done" ? "✓" : ""}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`break-words font-semibold ${t.status === "done" ? "line-through" : ""}`}>{t.title}</p>
                      {t.detail && <p className="mt-0.5 text-sm text-gray-600">{t.detail}</p>}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {t.requires_official_check && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">自治体公式情報を確認</span>}
                        {t.providerName && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">{t.providerName}（架空）</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`${t.title}の状態`}>
                    {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={t.status === s}
                        disabled={saving === t.id}
                        onClick={() => change(t.id, s)}
                        className={`min-h-9 rounded-lg border text-xs font-bold transition ${
                          t.status === s ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-200 bg-white text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <DemoNotice className="mt-6" />
          </>
        )}
      </div>
    </div>
  );
}
