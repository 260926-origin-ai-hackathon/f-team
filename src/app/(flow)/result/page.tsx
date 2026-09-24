"use client";

import Link from "next/link";
import { formatYen, type Recommendation } from "@/lib/care/types";
import { AppShell, primaryButtonClass, secondaryButtonClass } from "../../_components/AppShell";
import { useFlow } from "../../_components/FlowProvider";

export default function ResultPage() {
  const { status, result, error, answers, requestRecommendation } = useFlow();

  return (
    <AppShell
      title="おすすめの施設"
      step={3}
      backHref="/questions"
      footer={
        status === "loading" ? undefined : (
          <div className="grid grid-cols-2 gap-2">
            <Link href="/questions" className={secondaryButtonClass}>
              条件を変える
            </Link>
            <Link href="/" className={primaryButtonClass}>
              最初に戻る
            </Link>
          </div>
        )
      }
    >
      {status === "idle" && (
        <Message text="まだ希望条件が入力されていません。最初から診断をはじめてください。" />
      )}

      {status === "loading" && (
        <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
          <div>
            <p className="font-bold">AIが施設を絞り込んでいます</p>
            <p className="mt-1 text-sm text-gray-500">ご本人の情報と施設情報を照らし合わせています…</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-4 pt-6">
          <Message text={error ?? "エラーが発生しました。"} tone="error" />
          <button type="button" onClick={() => requestRecommendation(answers)} className={primaryButtonClass}>
            もう一度試す
          </button>
        </div>
      )}

      {status === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-emerald-600 p-4 text-white shadow-md shadow-emerald-100">
            <p className="text-xs font-semibold opacity-90">登録施設 {result.totalFacilities}件 から</p>
            <p className="text-lg font-bold">お母さまに合う施設を{result.recommendations.length}件見つけました</p>
            {result.summary && <p className="mt-2 text-[13px] leading-relaxed opacity-95">{result.summary}</p>}
          </div>

          {result.recommendations.map((rec) => (
            <FacilityCard key={rec.facilityId} rec={rec} />
          ))}

          {result.excluded.length > 0 && (
            <section className="rounded-3xl bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-bold text-gray-500">今回は見送った施設</p>
              <ul className="divide-y divide-gray-100">
                {result.excluded.map((item) => (
                  <li key={item.facilityId} className="flex gap-2 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] text-gray-500">
                      ✕
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{item.facilityName}</p>
                      <p className="break-words text-xs leading-relaxed text-gray-500">{item.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.nextSteps.length > 0 && (
            <section className="rounded-3xl bg-emerald-50 p-4">
              <p className="mb-2 text-sm font-bold text-emerald-700">次にできること</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                {result.nextSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </section>
          )}

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            ※ AIによる参考情報です。医学的な判断や施設の安全性を保証するものではありません。見学やケアマネジャーへの相談もあわせてご検討ください。
          </p>
        </div>
      )}
    </AppShell>
  );
}

function FacilityCard({ rec }: { rec: Recommendation }) {
  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-sm">
      <div className="flex items-start gap-3 p-4 pb-3">
        <span
          className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl text-white ${
            rec.rank === 1 ? "bg-emerald-600" : "bg-emerald-400"
          }`}
        >
          <span className="text-base font-bold leading-none">{rec.rank}</span>
          <span className="text-[9px] leading-none">位</span>
        </span>
        <div className="min-w-0">
          <h2 className="break-words font-bold leading-snug">{rec.facilityName}</h2>
          <p className="mt-0.5 break-words text-xs text-gray-500">
            {rec.facilityType} ・ 月額{formatYen(rec.monthlyFeeYen)}
          </p>
        </div>
      </div>

      {rec.fitSummary && (
        <div className="mx-4 rounded-2xl bg-emerald-50 p-3">
          <p className="text-xs font-bold text-emerald-700">なぜ合う？</p>
          <p className="mt-1 text-sm leading-relaxed">{rec.fitSummary}</p>
        </div>
      )}

      {rec.cautions.length > 0 && (
        <div className="mx-4 mt-3">
          <p className="text-xs font-bold text-rose-600">注意点</p>
          <ul className="mt-1 space-y-1 text-sm">
            {rec.cautions.map((item) => (
              <li key={item} className="flex gap-1.5 leading-relaxed">
                <span className="text-rose-400">!</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="group mt-3 border-t border-gray-100">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-500">
          理由をくわしく見る
          <span className="transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-3 px-4 pb-4 text-sm">
          <BulletList title="おすすめ理由" items={rec.reasons} />
          <BulletList title="ご本人の条件との適合点" items={rec.matches} />
          <p className="text-xs text-gray-400">{rec.address}</p>
        </div>
      </details>
    </article>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold text-emerald-700">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 leading-relaxed">
            <span className="text-emerald-500">✓</span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <p
      className={`rounded-2xl p-4 text-sm leading-relaxed ${
        tone === "error" ? "bg-red-50 text-red-700" : "bg-white text-gray-600 shadow-sm"
      }`}
    >
      {text}
    </p>
  );
}
