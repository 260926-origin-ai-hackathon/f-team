"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClientReply } from "@/lib/care-agent/workflow";
import { fetchCase, rememberCase, sendTurn, type CaseView } from "../../_care/client";
import { DemoNotice, Section, Spinner, labelDims, primaryButton, secondaryButton } from "../../_care/ui";

type Message = CaseView["messages"][number];
type Run = CaseView["runs"][number];
type Proposal = Run["proposals"][number];
type Provider = {
  provider_id: string;
  provider_name: string;
  service_name: string;
  city: string;
  address: string;
  capacity: number | null;
  summary: string;
  phone_display: string;
  distance_km: number;
  origin_label: string;
};

const EXAMPLE =
  "母が最近一人でお風呂に入るのが難しくなってきました。私は平日は仕事なので昼間はいません。母はできれば自宅で暮らし続けたいと言っています。どうしたらよいでしょうか？";

export default function ConsultPage() {
  return (
    <Suspense>
      <Consult />
    </Suspense>
  );
}

function Consult() {
  const { caseId } = useParams<{ caseId: string }>();
  const fault = useSearchParams().get("fault");
  const [view, setView] = useState<CaseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setView(await fetchCase(caseId));
      setLoadError(null);
      rememberCase(caseId);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }, [caseId]);

  useEffect(() => {
    let active = true;
    fetchCase(caseId)
      .then((v) => {
        if (!active) return;
        setView(v);
        rememberCase(caseId);
      })
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : "読み込めませんでした。"));
    return () => {
      active = false;
    };
  }, [caseId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view?.messages.length, progress]);

  async function submit(reply: ClientReply) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setProgress("送信しています");
    if (reply.type === "message") setDraft("");
    // Optimistic user bubble; the server copy replaces it on reload.
    setView((v) =>
      v && reply.type === "message"
        ? { ...v, messages: [...v.messages, { id: `tmp-${Date.now()}`, role: "user", kind: "text", content: reply.text, payload: {}, created_at: "" }] }
        : v,
    );
    await sendTurn(
      caseId,
      reply,
      (event) => {
        if (event.type === "progress") setProgress(event.label);
        if (event.type === "notice" || event.type === "error") setNotice(event.message);
      },
      fault,
    );
    setProgress(null);
    await reload();
    setBusy(false);
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6 text-center">
        <p className="text-sm text-red-700">{loadError}</p>
        <Link href="/" className={primaryButton}>
          最初から始める
        </Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="読み込んでいます" />
      </div>
    );
  }

  const latestRun = view.runs.at(-1);
  const lastQuestion = [...view.messages].reverse().find((m) => m.kind === "question");
  const lastProviderList = [...view.messages].reverse().find((m) => m.kind === "provider_list");
  const hasUserMessage = view.messages.some((m) => m.role === "user");
  const canConsultMore = view.budget.proposalsLeft > 0;
  const inputDisabled = busy || view.budget.messagesLeft <= 0;

  return (
    <div className="flex h-dvh justify-center bg-[#F6FAF7] text-gray-800">
      <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-emerald-100 bg-white p-5 lg:block">
        <ProfilePanel view={view} />
      </aside>
      <div className="flex h-dvh w-full max-w-3xl flex-col">
        <header className="shrink-0 border-b border-emerald-100 bg-white/95 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-wide text-emerald-700">介護の相談AI（デモ）</p>
              <h1 className="truncate text-base font-bold">{view.displayName}のご相談</h1>
            </div>
            <div className="flex shrink-0 gap-2">
              {view.tasks.length > 0 && (
                <Link href={`/tasks/${caseId}`} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                  タスク
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowProfile((s) => !s)}
                aria-expanded={showProfile}
                className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800 lg:hidden"
              >
                登録情報
              </button>
            </div>
          </div>
          {showProfile && (
            <div className="mt-2 max-h-[45dvh] overflow-y-auto rounded-2xl border border-emerald-100 bg-white p-4 lg:hidden">
              <ProfilePanel view={view} />
            </div>
          )}
        </header>

        <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <AssistantBubble>
            <p>こんにちは。登録済みの情報（デモ利用者A・架空）を確認しています。</p>
            <p className="mt-1 font-semibold">今、一番困っていることを教えてください。</p>
          </AssistantBubble>
          {!hasUserMessage && (
            <button
              type="button"
              onClick={() => setDraft(EXAMPLE)}
              className="ml-2 rounded-2xl border border-dashed border-emerald-300 bg-white px-3 py-2 text-left text-xs text-emerald-800"
            >
              例文を入力欄に入れる：「{EXAMPLE.slice(0, 32)}…」
            </button>
          )}

          {view.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              view={view}
              busy={busy}
              isLatestQuestion={m.id === lastQuestion?.id && view.pending === "question"}
              isLatestProviderList={m.id === lastProviderList?.id && view.pending === "provider"}
              isLatestRun={(run) => run?.id === latestRun?.id && view.pending === "decision"}
              canConsultMore={canConsultMore}
              onReply={submit}
            />
          ))}

          {view.pending === "tasks" && (
            <AssistantBubble>
              <p>タスクを作成しました。進み具合を管理できます。</p>
              <Link href={`/tasks/${caseId}`} className={`${primaryButton} mt-2`}>
                タスクを確認する
              </Link>
              <p className="mt-2 text-xs text-gray-500">別のことを相談したい場合は、下の入力欄から続けられます。</p>
            </AssistantBubble>
          )}
          {progress && (
            <div className="ml-2">
              <Spinner label={`${progress}…`} />
            </div>
          )}
          {notice && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
          <div ref={bottomRef} />
        </main>

        <footer className="shrink-0 border-t border-emerald-100 bg-white px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
          {hasUserMessage && view.pending === "question" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ type: "request_proposal" })}
              className="mb-2 rounded-full border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800 disabled:opacity-50"
            >
              今ある情報で提案して
            </button>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void submit({ type: "message", text: draft.trim() });
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={1000}
              disabled={inputDisabled}
              placeholder={view.budget.messagesLeft > 0 ? "状況を自由に入力してください" : "送信回数の上限に達しました"}
              aria-label="相談内容"
              className="min-h-11 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2 text-base outline-none focus:border-emerald-500"
            />
            <button type="submit" disabled={inputDisabled || !draft.trim()} className={primaryButton}>
              送信
            </button>
          </form>
          <p className="mt-1 text-[10px] text-gray-400">
            残り送信 {view.budget.messagesLeft} 回 ・ 架空データのデモです。医学的な判断は行いません。
          </p>
        </footer>
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return <div className="mr-8 rounded-2xl rounded-tl-sm bg-white p-3 text-sm leading-relaxed shadow-sm">{children}</div>;
}

function MessageItem({
  message,
  view,
  busy,
  isLatestQuestion,
  isLatestProviderList,
  isLatestRun,
  canConsultMore,
  onReply,
}: {
  message: Message;
  view: CaseView;
  busy: boolean;
  isLatestQuestion: boolean;
  isLatestProviderList: boolean;
  isLatestRun: (run: Run | undefined) => boolean;
  canConsultMore: boolean;
  onReply: (reply: ClientReply) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-10 rounded-2xl rounded-tr-sm bg-emerald-600 p-3 text-sm leading-relaxed text-white">{message.content}</div>
    );
  }
  if (message.kind === "question") {
    const question = message.payload.question as { kind: string; catalogId?: string; choices?: { value: string; label: string }[] };
    return (
      <AssistantBubble>
        <p className="font-semibold">{message.content}</p>
        {question?.kind === "catalog" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {question.choices?.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={!isLatestQuestion || busy}
                onClick={() => onReply({ type: "catalog_answer", questionId: question.catalogId!, value: c.value, label: c.label })}
                className="min-h-10 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 transition enabled:hover:border-emerald-500 disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {question?.kind === "free_text" && isLatestQuestion && <p className="mt-1 text-xs text-gray-500">下の入力欄からお答えください。</p>}
      </AssistantBubble>
    );
  }
  if (message.kind === "proposal") {
    const run = view.runs.find((r) => r.id === message.payload.runId);
    const actionable = isLatestRun(run);
    return (
      <div className="space-y-3">
        <AssistantBubble>
          <p className="text-xs font-bold text-emerald-700">提案 {run?.round ?? ""}回目</p>
          <p>{message.content}</p>
        </AssistantBubble>
        {run?.proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} actionable={actionable} busy={busy} canConsultMore={canConsultMore} onReply={onReply} />
        ))}
        {actionable && (
          <button
            type="button"
            disabled={busy || !canConsultMore}
            onClick={() => onReply({ type: "consult_more" })}
            className={`${secondaryButton} w-full`}
          >
            {canConsultMore ? "他の案も相談する" : "提案の上限に達しました"}
          </button>
        )}
      </div>
    );
  }
  if (message.kind === "provider_list") {
    const providers = (message.payload.providers as Provider[]) ?? [];
    return (
      <div className="space-y-2">
        <AssistantBubble>
          <p>{message.content}</p>
          {typeof message.payload.distanceNote === "string" && <p className="mt-1 text-xs text-gray-500">{message.payload.distanceNote}</p>}
        </AssistantBubble>
        {providers.map((p) => (
          <div key={p.provider_id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-bold">{p.provider_name}</p>
                <p className="text-xs text-gray-500">
                  {p.service_name} ・ {p.city}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">架空の事業所</span>
            </div>
            <p className="mt-2 text-sm text-gray-700">{p.summary}</p>
            <p className="mt-2 text-xs text-gray-500">
              参考距離 約{p.distance_km}km（{p.origin_label}から）{p.capacity ? ` ・ 定員${p.capacity}名（デモ設定）` : ""} ・ 電話: {p.phone_display}
            </p>
            {isLatestProviderList && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onReply({ type: "select_provider", providerId: p.provider_id })}
                className={`${primaryButton} mt-3 w-full`}
              >
                この事業所に問い合わせる
              </button>
            )}
          </div>
        ))}
        {isLatestProviderList && (
          <button type="button" disabled={busy} onClick={() => onReply({ type: "select_provider", providerId: null })} className={`${secondaryButton} w-full`}>
            事業所はあとで決める
          </button>
        )}
      </div>
    );
  }
  if (message.kind === "tasks") return null;
  return (
    <AssistantBubble>
      <p className={message.kind === "notice" ? "text-amber-900" : undefined}>{message.content}</p>
    </AssistantBubble>
  );
}

function ProposalCard({
  proposal,
  actionable,
  busy,
  onReply,
}: {
  proposal: Proposal;
  actionable: boolean;
  busy: boolean;
  canConsultMore: boolean;
  onReply: (reply: ClientReply) => void;
}) {
  const c = proposal.content as Record<string, string[]>;
  const e = proposal.evidence;
  const list = (items?: string[]) =>
    items?.length ? (
      <ul className="space-y-1 text-sm leading-relaxed">
        {items.map((t) => (
          <li key={t} className="flex gap-1.5">
            <span className="text-emerald-600">・</span>
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${proposal.decision === "accepted" ? "border-emerald-500" : "border-gray-100"}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">{proposal.rank}</span>
        <div className="min-w-0">
          <h2 className="break-words font-bold leading-snug">{proposal.title}</h2>
          <p className="text-xs text-gray-500">{proposal.target_type === "service" ? "介護サービス" : "相談・手続き"}</p>
        </div>
        {proposal.decision === "accepted" && <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">選択済み</span>}
      </div>

      <div className="mt-3 space-y-3">
        {c.whyCandidate?.length ? <Section title="なぜ候補？">{list(c.whyCandidate)}</Section> : null}
        {c.relatedSituations?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {c.relatedSituations.map((s) => (
              <span key={s} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                {s}
              </span>
            ))}
          </div>
        ) : null}
        <Section title="確認できたこと">
          <ul className="space-y-1 text-sm leading-relaxed">
            {e.rules.map((r) => (
              <li key={r.ruleId}>
                ・{r.explanation}
                <span className="ml-1 text-[11px] text-gray-400">（{r.ruleId}・デモ用簡略ルール）</span>
              </li>
            ))}
            {c.institutionalBasis?.map((t) => <li key={t}>・{t}</li>)}
            {e.nearbyProviderCount !== null && (
              <li>・{e.nearbyProviderCount > 0 ? `周辺に対象の事業所があります（${e.nearbyProviderCount}件・架空）` : "周辺に対象の事業所は見つかりませんでした"}</li>
            )}
            {e.webChecked && <li>・{e.webChecked.available ? "公式Web情報を確認しました（要最終確認）" : "公式Web情報は確認できませんでした（DB内の情報で提案）"}</li>}
          </ul>
        </Section>
        {(c.populationContext?.length || e.statTables.length) ? (
          <Section title="参考となる利用傾向">
            {list(c.populationContext)}
            {e.statTables.map((t) => (
              <p key={t.table} className="mt-1 text-[11px] leading-relaxed text-gray-400">
                参照：{t.title}（{t.table}）／条件：{labelDims(t.conditionedOn) || "なし"}のみ
                {t.multipleResponse ? "／複数回答" : ""}
                {t.isDemo ? "／架空のデモ値" : ""}
              </p>
            ))}
          </Section>
        ) : null}
        {c.unverified?.length ? <Section title="まだ確認したいこと">{list(c.unverified)}</Section> : null}
        {c.nextActions?.length ? <Section title="次にやること">{list(c.nextActions)}</Section> : null}
      </div>

      {actionable && (
        <button type="button" disabled={busy} onClick={() => onReply({ type: "accept", proposalId: proposal.id })} className={`${primaryButton} mt-4 w-full`}>
          この提案を進める
        </button>
      )}
    </article>
  );
}

function ProfilePanel({ view }: { view: CaseView }) {
  const sections: [string, { label: string; value: string }[]][] = [
    ["基本情報", view.profile.basic],
    ["介護・生活", view.profile.care],
    ["健康", view.profile.health],
    ["家族", view.profile.family],
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-bold">登録済みの情報</p>
        <p className="text-xs text-gray-500">{view.displayName}（架空のデモデータ）</p>
      </div>
      {sections.map(([title, rows]) =>
        rows.length ? (
          <section key={title}>
            <h2 className="mb-1 text-xs font-semibold text-gray-500">{title}</h2>
            <dl className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-1.5 text-sm">
                  <dt className="text-gray-500">{r.label}</dt>
                  <dd className="min-w-0 break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null,
      )}
      {view.wishes.length > 0 && (
        <section>
          <h2 className="mb-1 text-xs font-semibold text-gray-500">希望</h2>
          <ul className="space-y-1 text-sm">
            {view.wishes.map((w) => (
              <li key={`${w.holder}-${w.value}`}>
                <span className="text-xs text-gray-500">{w.holder}：</span>
                {w.value}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.learned.length > 0 && (
        <section>
          <h2 className="mb-1 text-xs font-semibold text-gray-500">会話から分かったこと</h2>
          <ul className="space-y-1 text-sm">
            {view.learned.map((l) => (
              <li key={`${l.label}-${l.value}`}>
                <span className="text-xs text-gray-500">{l.label}：</span>
                {l.value}
              </li>
            ))}
          </ul>
        </section>
      )}
      <DemoNotice />
    </div>
  );
}
