"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Answers, CareProfile, RecommendResult } from "@/lib/care/types";

type Status = "idle" | "loading" | "done" | "error";

type FlowState = {
  profile: CareProfile;
  answers: Answers;
  setAnswers: (answers: Answers) => void;
  status: Status;
  result: RecommendResult | null;
  error: string | null;
  requestRecommendation: (answers: Answers) => void;
};

const FlowContext = createContext<FlowState | null>(null);

// Pre-filled preferences so the demo can be run by just tapping "次へ".
const DEFAULT_ANSWERS: Answers = {
  area: "今の住まいの周辺",
  priority: "認知症ケア",
  budgetMaxYen: 220000,
  familyAccess: "とても重視する",
  privateRoom: "必須",
  careSupport: "24時間の手厚い見守り・看護を重視",
  desiredLife: "安全に見守られながら、料理や散歩など自分でできることを続けて、穏やかに暮らしてほしい。",
};

// Lives in the (flow) layout, so answers and results survive navigation between the step pages.
export function FlowProvider({ profile, children }: { profile: CareProfile; children: ReactNode }) {
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const requestRecommendation = useCallback(
    async (submitted: Answers) => {
      const id = ++requestId.current;
      setStatus("loading");
      setResult(null);
      setError(null);
      try {
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: profile.id, answers: submitted }),
        });
        const data = await res.json();
        if (id !== requestId.current) return;
        if (!res.ok) throw new Error(data.error ?? "エラーが発生しました。");
        setResult(data as RecommendResult);
        setStatus("done");
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : "エラーが発生しました。");
        setStatus("error");
      }
    },
    [profile.id],
  );

  return (
    <FlowContext.Provider value={{ profile, answers, setAnswers, status, result, error, requestRecommendation }}>
      {children}
    </FlowContext.Provider>
  );
}

export function useFlow() {
  const context = useContext(FlowContext);
  if (!context) throw new Error("useFlow must be used inside FlowProvider");
  return context;
}
