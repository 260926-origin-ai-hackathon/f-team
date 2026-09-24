"use client";

import Link from "next/link";
import { useState } from "react";
import type { CareProfile } from "@/lib/care/types";
import { AppShell, primaryButtonClass } from "../../_components/AppShell";
import { useFlow } from "../../_components/FlowProvider";

type Row = { label: string; value: string; primary?: boolean };

// Registered personal information only; facility-search preferences are asked in STEP2.
function sections(p: CareProfile): { title: string; rows: Row[] }[] {
  return [
    {
      title: "基本情報",
      rows: [
        { label: "氏名", value: p.display_name, primary: true },
        { label: "年齢", value: `${p.age}歳`, primary: true },
        { label: "性別", value: p.gender, primary: true },
        { label: "住所", value: p.address, primary: true },
        { label: "家族構成", value: p.household, primary: true },
        { label: "現在の住居", value: p.residence },
        { label: "緊急連絡先", value: p.emergency_contact },
      ],
    },
    {
      title: "介護・生活情報",
      rows: [
        { label: "要介護度", value: p.care_level, primary: true },
        { label: "認知症", value: p.dementia, primary: true },
        { label: "歩行", value: p.mobility, primary: true },
        { label: "服薬管理", value: p.medication, primary: true },
        { label: "入浴", value: p.bathing },
        { label: "排泄", value: p.toileting },
        { label: "食事", value: p.eating },
        { label: "日中の生活", value: p.daytime_life },
        { label: "介護サービス", value: p.care_services },
      ],
    },
    {
      title: "健康情報",
      rows: [
        { label: "持病", value: p.chronic_conditions, primary: true },
        { label: "医療処置", value: p.medical_needs, primary: true },
        { label: "服薬", value: p.medications },
        { label: "アレルギー", value: p.allergies },
      ],
    },
  ];
}

export default function ProfilePage() {
  const { profile } = useFlow();
  const [showAll, setShowAll] = useState(false);
  const all = sections(profile);
  const total = all.reduce((sum, s) => sum + s.rows.length, 0);
  const hidden = all.reduce((sum, s) => sum + s.rows.filter((r) => !r.primary).length, 0);

  return (
    <AppShell
      title="登録情報の確認"
      step={1}
      backHref="/"
      footer={
        <Link href="/questions" className={primaryButtonClass}>
          次へ
        </Link>
      }
    >
      <p className="mb-3 text-[13px] leading-relaxed text-gray-500">
        ご本人について、以下の{total}項目がすでに登録されています。入力は不要です。
      </p>

      <div className="space-y-4">
        {all.map((section) => (
          <section key={section.title}>
            <h2 className="mb-1 px-1 text-xs font-semibold text-gray-500">{section.title}</h2>
            <dl className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
              {section.rows
                .filter((row) => showAll || row.primary)
                .map((row) => (
                  <div key={row.label} className="grid grid-cols-[6.5rem_1fr] gap-2 px-4 py-2">
                    <dt className="text-sm text-gray-500">{row.label}</dt>
                    <dd className="min-w-0 break-words text-sm text-gray-900">{row.value}</dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowAll(!showAll)}
        aria-expanded={showAll}
        className="mt-3 w-full py-2 text-center text-sm font-semibold text-emerald-700"
      >
        {showAll ? "主な項目だけ表示" : `詳細を見る（ほか${hidden}項目）`}
      </button>
    </AppShell>
  );
}
