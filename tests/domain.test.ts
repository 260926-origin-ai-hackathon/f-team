import { describe, expect, it } from "vitest";
import {
  buildLlmCaseView,
  careLevelOrdinal,
  evaluateRules,
  inferNeedsFromFacts,
  maskIdentity,
  violatesStatPolicy,
  type EligibilityRule,
  type FactRow,
} from "@/lib/care-agent/domain";

const identity = { display_name: "デモ利用者A（架空）", address_detail: "大阪府吹田市（架空の住所）", phone: "090-1234-5678" };

describe("sanitize layer", () => {
  it("never puts case_identities or blocked keys into the LLM case view", () => {
    const facts: FactRow[] = [
      { fact_key: "care_level", value: "要介護2", value_status: "known", source: "registered_profile" },
      { fact_key: "phone", value: "090-1234-5678", value_status: "known", source: "user_message" },
      { fact_key: "family_note", value: "デモ利用者Aは入浴が難しい", value_status: "known", source: "user_message" },
      { fact_key: "need:bathing_support", value: true, value_status: "known", source: "agent_inferred" },
      { fact_key: "certification_status", value: null, value_status: "unknown", source: "catalog_answer" },
    ];
    const view = buildLlmCaseView(facts, [], identity);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("090-1234-5678");
    expect(serialized).not.toContain("デモ利用者A");
    expect(view.facts.care_level).toBe("要介護2");
    expect(view.needs).toEqual(["bathing_support"]);
    expect(view.unknownFacts).toEqual(["certification_status"]);
  });

  it("masks identities, phone numbers and e-mail addresses in free text", () => {
    const masked = maskIdentity("デモ利用者A（架空）の件です。連絡先は090-1234-5678、a.b@example.com まで", identity);
    expect(masked).not.toMatch(/デモ利用者A|090-1234-5678|example\.com/);
  });
});

describe("eligibility rules (evaluated by code, not by the LLM)", () => {
  const rules: EligibilityRule[] = [
    {
      rule_id: "R002", target_service_code: "S011", target_action_code: null, condition: { care_level_below: 3 },
      effect: "not_eligible_in_principle", explanation: "原則要介護3以上", source: "demo", caveat: "demo", is_demo_rule: true,
    },
    {
      rule_id: "R001", target_service_code: null, target_action_code: "A001", condition: { certification_status_in: ["not_applied", "unknown"] },
      effect: "recommend_action", explanation: "認定が必要", source: "demo", caveat: "demo", is_demo_rule: true,
    },
  ];

  it("flags 介護老人福祉施設 for 要介護2 and not for 要介護3", () => {
    expect(evaluateRules(rules, { care_level: "要介護2", certification_status: "certified" }).map((o) => o.ruleId)).toEqual(["R002"]);
    expect(evaluateRules(rules, { care_level: "要介護3", certification_status: "certified" })).toEqual([]);
  });

  it("does not hard-reject when the care level is unknown", () => {
    expect(evaluateRules(rules, { certification_status: "certified" })).toEqual([]);
  });

  it("recommends the certification application when not applied", () => {
    expect(evaluateRules(rules, { care_level: "要介護2", certification_status: "not_applied" }).map((o) => o.ruleId)).toContain("R001");
  });

  it("orders care levels (要支援 < 要介護)", () => {
    expect(careLevelOrdinal("要支援2")).toBeLessThan(careLevelOrdinal("要介護1")!);
    expect(careLevelOrdinal("不明")).toBeNull();
  });
});

describe("fallback need inference and statistics wording policy", () => {
  it("infers needs from registered facts when Gemini is unavailable", () => {
    const needs = inferNeedsFromFacts({ bathing: "一部介助", household: "一人暮らし", medication_management: "管理支援が必要", certification_status: "certified" });
    expect(needs).toEqual(expect.arrayContaining(["bathing_support", "daytime_supervision", "medication_support"]));
    expect(needs).not.toContain("certification_needed");
  });

  it("detects 'statistics = recommendation' reasoning", () => {
    expect(violatesStatPolicy("要介護2で通所系の利用が多いので通所介護にすべきです。")).toBe(true);
    expect(violatesStatPolicy("要介護度別の集計で通所系の利用が観測されていますが、推薦の根拠ではありません。")).toBe(false);
  });
});
