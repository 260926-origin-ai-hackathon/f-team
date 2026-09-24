import Link from "next/link";
import type { ReactNode } from "react";

// Mobile app frame: fixed header, scrollable body, fixed footer CTA. Uses dvh so the footer is never cut off.
export function AppShell({
  title,
  step,
  backHref,
  onBack,
  footer,
  children,
}: {
  title: string;
  step: 1 | 2 | 3;
  backHref?: string;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const backClass =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 transition active:bg-emerald-100";
  const backIcon = (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-[#F6FAF7] text-gray-800 shadow-xl shadow-emerald-100/60">
      <header className="shrink-0 bg-[#F6FAF7] px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="flex items-center gap-1">
          {backHref ? (
            <Link href={backHref} aria-label="戻る" className={backClass}>
              {backIcon}
            </Link>
          ) : onBack ? (
            <button type="button" onClick={onBack} aria-label="戻る" className={backClass}>
              {backIcon}
            </button>
          ) : (
            <span className="h-10 w-10 shrink-0" />
          )}
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] font-bold tracking-wider text-emerald-600">STEP {step} / 3</p>
            <h1 className="truncate text-base font-bold">{title}</h1>
          </div>
          <span className="h-10 w-10 shrink-0" />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 px-2" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-1 rounded-full ${n <= step ? "bg-emerald-500" : "bg-emerald-100"}`} />
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-2">{children}</main>

      {footer && (
        <footer className="shrink-0 border-t border-emerald-100 bg-white/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {footer}
        </footer>
      )}
    </div>
  );
}

export const primaryButtonClass =
  "flex h-14 w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 text-base font-bold text-white shadow-lg shadow-emerald-100 transition active:scale-[0.98] disabled:opacity-50";

export const secondaryButtonClass =
  "flex h-14 w-full items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-base font-bold text-gray-600 transition active:scale-[0.98]";
