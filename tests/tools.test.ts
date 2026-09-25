import { describe, expect, it } from "vitest";
import { getNeedServiceCandidates, queryStatTableData, runTool, searchOfficialWeb, searchProviders, type ToolContext } from "@/lib/care-agent/tools";
import { fakeSupabase } from "./fake-supabase";

function statTables() {
  return {
    stat_tables: [
      {
        id: "t42", table_code: "K25-42", table_number: 42, title: "要介護度×利用した介護サービス",
        dimension_keys: ["care_level", "service_category"], measure_definition: "介護を要する者数（デモ値）",
        multiple_response: true, is_demo: true, stat_datasets: { dataset_code: "K25", dataset_name: "2025年国民生活基礎調査" },
      },
    ],
    stat_observations: [
      { table_id: "t42", dimensions: { care_level: "要介護2", service_category: "訪問系" }, value: 1200, unit: "デモ値" },
      { table_id: "t42", dimensions: { care_level: "要介護3", service_category: "訪問系" }, value: 900, unit: "デモ値" },
    ],
  };
}

function ctx(tables: Record<string, Record<string, unknown>[]>, faults: ToolContext["faults"] = new Set()): ToolContext {
  return { sb: fakeSupabase(tables), caseId: "c1", runId: "r1", cityCode: "27205", facts: {}, identity: null, faults };
}

describe("Stat Query Tool", () => {
  it("returns the required provenance fields and limitations", async () => {
    const result = await queryStatTableData(fakeSupabase(statTables()), "K25-42", { care_level: "要介護2" });
    expect(result).toMatchObject({ dataset: "K25", table: "K25-42", conditioned_on: ["care_level"], multiple_response: true, is_demo: true });
    expect(result.not_conditioned_on).toEqual(expect.arrayContaining(["service_category", "age", "dementia", "caregiver_work"]));
    expect(result.results).toHaveLength(1);
    expect(result.limitations.join()).toMatch(/個人の記録ではありません/);
    expect(result.limitations.join()).toMatch(/複数回答/);
  });

  it("refuses dimensions from other tables (no cross-table synthetic person)", async () => {
    await expect(
      queryStatTableData(fakeSupabase(statTables()), "K25-42", { care_level: "要介護2", caregiver_work: "仕事あり" }),
    ).rejects.toThrow(/has no dimension\(s\) caregiver_work/);
  });
});

describe("tool results are the source of truth", () => {
  it("persists the tool's own return value and classifies empty/error", async () => {
    const tables: Record<string, Record<string, unknown>[]> = {};
    const c = ctx(tables);
    const ok = await runTool(c, "t_ok", { a: 1 }, async () => ({ results: [{ v: 1 }] }));
    const empty = await runTool(c, "t_empty", {}, async () => ({ results: [] }));
    const failed = await runTool(c, "t_err", {}, async () => { throw new Error("boom"); });
    expect([ok.status, empty.status, failed.status]).toEqual(["ok", "empty", "error"]);
    expect(tables.proposal_sources.map((r) => [r.tool_name, (r.result as { status: string }).status])).toEqual([
      ["t_ok", "ok"], ["t_empty", "empty"], ["t_err", "error"],
    ]);
  });

  it("is idempotent for the same tool call (retry/resume safe)", async () => {
    const tables: Record<string, Record<string, unknown>[]> = {};
    const c = ctx(tables);
    await runTool(c, "t", { b: 2, a: 1 }, async () => ({ results: [1] }));
    await runTool(c, "t", { a: 1, b: 2 }, async () => ({ results: [1] }));
    expect(tables.proposal_sources).toHaveLength(1);
  });
});

describe("failure fallbacks", () => {
  it("returns an empty provider list (no crash) when no provider matches", async () => {
    const result = await searchProviders(ctx({}, new Set(["providers_empty"])), ["S002"]);
    expect(result.status).toBe("empty");
  });

  it("reports DB failures as an error result instead of throwing", async () => {
    const result = await searchProviders(ctx({}, new Set(["db"])), ["S002"]);
    expect(result.status).toBe("error");
  });

  it("continues with DB information only when web search fails", async () => {
    const result = await searchOfficialWeb(ctx({ case_usage: [] }, new Set(["web"])), "吹田市 要介護認定 申請窓口");
    expect(result).toMatchObject({ available: false });
    expect(result.status).toBe("empty");
  });

  it("does not search the web twice in one case", async () => {
    const result = await searchOfficialWeb(ctx({ case_usage: [{ case_id: "c1", kind: "web_search" }] }), "query");
    expect(result).toMatchObject({ available: false, reason: "web_search_budget_exhausted" });
  });
});

describe("need candidates include consultation windows and programs", () => {
  it("returns program candidates with their stored conditions", async () => {
    const tables = {
      need_service_mappings: [{ need_code: "cost_burden", need_label: "費用負担が心配", service_code: null, action_code: "A003", strength: "primary", rationale: "r" }],
      need_program_mappings: [
        {
          need_code: "cost_burden", need_label: "費用負担が心配", program_code: "P001", strength: "primary", rationale: "r",
          care_programs: { name: "高額介護サービス費", conditions_note: "c", where_to_apply: "w", caveat: "k" },
        },
      ],
    };
    const result = await getNeedServiceCandidates(ctx(tables), ["cost_burden"]);
    expect(result.status).toBe("ok");
    expect(result.results).toEqual([
      expect.objectContaining({ action_code: "A003" }),
      expect.objectContaining({ program_code: "P001", service_code: null, action_code: null, program: expect.objectContaining({ where_to_apply: "w" }) }),
    ]);
  });
});
