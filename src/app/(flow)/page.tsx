import Link from "next/link";
import { primaryButtonClass } from "../_components/AppShell";

// App start screen: service name, one-line description, and a single CTA.
export default function StartPage() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-gradient-to-b from-white to-emerald-50 text-gray-800 shadow-xl shadow-emerald-900/5">
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-emerald-600 shadow-lg shadow-emerald-600/20">
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 9.5V20h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 17s-3-1.9-3-4a1.7 1.7 0 0 1 3-1.1A1.7 1.7 0 0 1 15 13c0 2.1-3 4-3 4Z" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">AI介護施設選びサポート</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-gray-600">
          登録されているご本人の情報をもとに、
          <br />
          あなたのご家族に合った介護施設を
          <br />
          AIが探します。
        </p>
      </main>

      <footer className="shrink-0 px-6 pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <Link href="/profile" className={primaryButtonClass}>
          診断をはじめる
        </Link>
        <p className="mt-3 text-center text-[11px] text-gray-400">DEMO ・ 表示される人物・施設はすべて架空のデータです</p>
      </footer>
    </div>
  );
}
