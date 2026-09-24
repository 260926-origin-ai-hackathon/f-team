"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AREA_OPTIONS,
  BUDGET_OPTIONS,
  CARE_SUPPORT_OPTIONS,
  DESIRED_LIFE_MAX_LENGTH,
  FAMILY_ACCESS_OPTIONS,
  PRIORITY_OPTIONS,
  PRIVATE_ROOM_OPTIONS,
  formatYen,
  type Answers,
} from "@/lib/care/types";
import { AppShell, primaryButtonClass, secondaryButtonClass } from "../../_components/AppShell";
import { useFlow } from "../../_components/FlowProvider";

type ChoiceStep = {
  key: Exclude<keyof Answers, "desiredLife">;
  title: string;
  options: readonly (string | number)[];
  columns?: 2;
  format?: (value: number) => string;
};

const CHOICE_STEPS: ChoiceStep[] = [
  { key: "area", title: "入居先の希望地域は？", options: AREA_OPTIONS },
  { key: "priority", title: "施設選びで最も重視することは？", options: PRIORITY_OPTIONS },
  {
    key: "budgetMaxYen",
    title: "月額費用の上限は？",
    options: BUDGET_OPTIONS,
    columns: 2,
    format: (yen) => `${formatYen(yen)}まで`,
  },
  { key: "familyAccess", title: "ご家族が訪問しやすいことは、どのくらい大切ですか？", options: FAMILY_ACCESS_OPTIONS },
  { key: "privateRoom", title: "個室は必須ですか？", options: PRIVATE_ROOM_OPTIONS },
  { key: "careSupport", title: "医療・見守り体制はどのくらい重視しますか？", options: CARE_SUPPORT_OPTIONS },
];

const TOTAL = CHOICE_STEPS.length + 1;

export default function QuestionsPage() {
  const router = useRouter();
  const { answers, setAnswers, requestRecommendation } = useFlow();
  const [index, setIndex] = useState(0);
  const isLast = index === TOTAL - 1;
  const step = CHOICE_STEPS[index];

  function back() {
    if (index === 0) router.push("/profile");
    else setIndex(index - 1);
  }

  function next() {
    if (!isLast) {
      setIndex(index + 1);
      return;
    }
    requestRecommendation(answers);
    router.push("/result");
  }

  return (
    <AppShell
      title="追加の質問"
      step={2}
      onBack={back}
      footer={
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" onClick={back} className={secondaryButtonClass}>
            戻る
          </button>
          <button type="button" onClick={next} className={primaryButtonClass}>
            {isLast ? "AIにおすすめを聞く" : "次へ"}
          </button>
        </div>
      }
    >
      <div className="mb-5 mt-1">
        <div className="flex items-baseline justify-between text-xs font-semibold text-gray-500">
          <span>
            質問 <span className="text-lg font-bold text-emerald-600">{index + 1}</span> / {TOTAL}
          </span>
          <span>登録情報では分からない希望条件です</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${((index + 1) / TOTAL) * 100}%` }}
          />
        </div>
      </div>

      {step ? (
        <fieldset key={step.key}>
          <legend className="mb-4 text-xl font-bold leading-snug">{step.title}</legend>
          <div role="radiogroup" className={`grid gap-2.5 ${step.columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {step.options.map((option) => {
              const selected = answers[step.key] === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAnswers({ ...answers, [step.key]: option } as Answers)}
                  className={`flex min-h-14 items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3 text-left text-[15px] font-semibold transition active:scale-[0.98] ${
                    selected
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-transparent bg-white text-gray-700 shadow-sm"
                  }`}
                >
                  <span className="min-w-0 break-words">
                    {typeof option === "number" && step.format ? step.format(option) : option}
                  </span>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
                      selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300"
                    }`}
                    aria-hidden
                  >
                    {selected && "✓"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div>
          <label htmlFor="desiredLife" className="mb-2 block text-xl font-bold leading-snug">
            お母さまに、どんな暮らしを送ってほしいですか？
          </label>
          <p className="mb-3 text-sm text-gray-500">自由にご記入ください（任意）</p>
          <textarea
            id="desiredLife"
            value={answers.desiredLife}
            maxLength={DESIRED_LIFE_MAX_LENGTH}
            onChange={(e) => setAnswers({ ...answers, desiredLife: e.target.value })}
            rows={5}
            className="w-full resize-none rounded-2xl border-2 border-transparent bg-white p-4 text-base leading-relaxed shadow-sm outline-none focus:border-emerald-500"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {answers.desiredLife.length} / {DESIRED_LIFE_MAX_LENGTH}
          </p>
        </div>
      )}
    </AppShell>
  );
}
