import type { ReactNode } from "react";

export const DIMENSION_LABELS: Record<string, string> = {
  care_level: "要介護度",
  service_category: "サービス区分",
  caregiving_time: "介護時間",
  non_use_reason: "利用しない理由",
  caregiver_work: "介護者の仕事",
  relationship: "続柄",
  main_care_content: "主な介護内容",
  caregiver_combination: "介護者の組合せ",
  service_type: "サービス種類",
  service_content: "サービス内容",
  content_type: "内容類型",
  duration: "所要時間",
  facility_type: "施設種類",
  sex: "性別",
  age_group: "年齢階級",
  dementia_independence: "認知症の自立度",
  bedridden_level: "寝たきり度",
  region: "地域",
  age: "年齢",
  dementia: "認知症",
  household: "世帯",
};

export const labelDims = (keys: string[]) => keys.map((k) => DIMENSION_LABELS[k] ?? k).join("・");

export function DemoNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-xl bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-900 ${className}`}>
      このデモでは架空データを使用しています。人物・事業所・統計値はすべて架空で、公式の数値ではありません。
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600" role="status" aria-live="polite">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
      {label}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-gray-500">{title}</p>
      {children}
    </div>
  );
}

export const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
