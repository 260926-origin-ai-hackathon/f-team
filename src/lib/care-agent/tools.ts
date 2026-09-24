import { FunctionTool } from "@google/adk";
import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  BUDGET,
  EMBEDDING_DIMENSIONS,
  MODELS,
  NEED_CODES,
  SERVICE_CODES,
  STAT_TABLE_CODES,
  evaluateRules,
  maskIdentity,
  type CaseIdentity,
} from "./domain";
import {
  getEligibilityRules,
  getNeedMappings,
  getUsage,
  recordUsage,
  saveToolResult,
  type SourceRow,
} from "./repo";

// Tools are typed functions. Their return values are persisted verbatim to proposal_sources and
// that stored copy is the source of truth; values echoed by a model are never re-saved (spike S8).

export type Fault = "gemini" | "db" | "web" | "providers_empty";

export type ToolContext = {
  sb: SupabaseClient;
  caseId: string;
  runId: string;
  cityCode: string | null;
  facts: Record<string, unknown>;
  identity: CaseIdentity | null;
  faults: ReadonlySet<Fault>;
};

export type ToolResult = Record<string, unknown> & { status: SourceRow["status"] };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** Runs a tool implementation, classifies the outcome and saves the typed result (idempotent). */
export async function runTool(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  impl: () => Promise<Record<string, unknown>>,
): Promise<ToolResult> {
  let result: ToolResult;
  try {
    const data = await impl();
    const empty = Array.isArray(data.results) && data.results.length === 0;
    result = { status: empty ? "empty" : "ok", ...data };
  } catch (error) {
    result = { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  try {
    await saveToolResult(ctx.sb, ctx.caseId, ctx.runId, toolName, args, result, result.status, `${toolName}:${stableStringify(args)}`);
  } catch (error) {
    console.error(`failed to persist ${toolName} result`, error);
  }
  return result;
}

function failIfDbFault(ctx: ToolContext) {
  if (ctx.faults.has("db")) throw new Error("DB取得に失敗しました（障害注入）");
}

// ---------------------------------------------------------------------------
// Rule Query Tool: institutional eligibility, evaluated by code on the stored case facts.
export async function getEligibleServices(ctx: ToolContext) {
  return runTool(ctx, "get_eligible_services", {}, async () => {
    failIfDbFault(ctx);
    const outcomes = evaluateRules(await getEligibilityRules(ctx.sb), ctx.facts);
    return {
      results: outcomes,
      evaluatedOn: { care_level: ctx.facts.care_level ?? null, certification_status: ctx.facts.certification_status ?? null },
      note: "デモ用の簡略ルール。該当しないサービスは制度上の候補になり得る（最終確認は自治体・事業所へ）。",
    };
  });
}

// Need -> candidate services (suitability knowledge, separate from eligibility).
export async function getNeedServiceCandidates(ctx: ToolContext, needCodes: string[]) {
  const needs = needCodes.filter((code) => (NEED_CODES as readonly string[]).includes(code));
  return runTool(ctx, "get_need_service_candidates", { needCodes: needs }, async () => {
    failIfDbFault(ctx);
    return { results: await getNeedMappings(ctx.sb, needs) };
  });
}

// ---------------------------------------------------------------------------
// Stat Query Tool: one aggregate table per call; conditions must be that table's own dimensions.
const PERSON_ATTRIBUTES = ["age", "care_level", "dementia", "household", "caregiver_work", "relationship", "caregiving_time", "main_care_content"];

export class StatQueryError extends Error {}

export type StatQueryResult = {
  dataset: string;
  datasetName: string;
  table: string;
  tableNumber: number | null;
  title: string;
  conditioned_on: string[];
  not_conditioned_on: string[];
  measure: string;
  multiple_response: boolean;
  results: { dimensions: Record<string, unknown>; value: number; unit: string }[];
  limitations: string[];
  is_demo: boolean;
};

export async function queryStatTableData(
  sb: SupabaseClient,
  tableCode: string,
  conditions: Record<string, string>,
): Promise<StatQueryResult> {
  const { data: table, error } = await sb
    .from("stat_tables")
    .select("id, table_code, table_number, title, dimension_keys, measure_definition, multiple_response, is_demo, stat_datasets(dataset_code, dataset_name)")
    .eq("table_code", tableCode)
    .maybeSingle();
  if (error) throw new Error(`stat table lookup failed: ${error.message}`);
  if (!table) throw new StatQueryError(`unknown stat table: ${tableCode}`);
  const dims = table.dimension_keys as string[];
  const invalid = Object.keys(conditions).filter((key) => !dims.includes(key));
  if (invalid.length) {
    // Conditions from other tables are rejected: tables must never be combined into a synthetic person.
    throw new StatQueryError(`table ${tableCode} has no dimension(s) ${invalid.join(", ")}; allowed: ${dims.join(", ")}`);
  }
  const { data: rows, error: obsError } = await sb
    .from("stat_observations")
    .select("dimensions, value, unit")
    .eq("table_id", table.id)
    .contains("dimensions", conditions);
  if (obsError) throw new Error(`stat observations failed: ${obsError.message}`);
  const dataset = (Array.isArray(table.stat_datasets) ? table.stat_datasets[0] : table.stat_datasets) as {
    dataset_code: string;
    dataset_name: string;
  };
  const conditionedOn = Object.keys(conditions);
  const notConditioned = [...new Set([...dims, ...PERSON_ATTRIBUTES])].filter((k) => !conditionedOn.includes(k));
  const limitations = [
    "集計表のセル値（人数等）であり、個人の記録ではありません。",
    "他の集計表と組み合わせて、全条件を同時に満たす人の傾向を作ることはできません。",
    "利用が多いことは、その人にとって最適であることを意味しません。",
  ];
  if (table.multiple_response) limitations.push("複数回答の表のため、サービス別の値を合計しても全体数にはなりません。");
  if (table.is_demo) limitations.push("デモ用の架空値であり、公式統計の値ではありません。");
  return {
    dataset: dataset.dataset_code,
    datasetName: dataset.dataset_name,
    table: table.table_code,
    tableNumber: table.table_number,
    title: table.title,
    conditioned_on: conditionedOn,
    not_conditioned_on: notConditioned,
    measure: table.measure_definition,
    multiple_response: table.multiple_response,
    results: (rows ?? []) as StatQueryResult["results"],
    limitations,
    is_demo: table.is_demo,
  };
}

export async function queryStatTable(ctx: ToolContext, tableCode: string, conditions: Record<string, string>) {
  return runTool(ctx, "query_stat_table", { tableCode, conditions }, async () => {
    failIfDbFault(ctx);
    return (await queryStatTableData(ctx.sb, tableCode, conditions)) as unknown as Record<string, unknown>;
  });
}

// Service ontology: dataset concept <-> canonical care service.
export async function mapServiceConcepts(ctx: ToolContext, args: { datasetCode?: string; conceptCode?: string; serviceCode?: string }) {
  return runTool(ctx, "map_service_concepts", args, async () => {
    failIfDbFault(ctx);
    let query = ctx.sb
      .from("service_mappings")
      .select("relation, service_code, care_services(name), source_service_concepts!inner(dataset_code, concept_code, concept_label)");
    if (args.serviceCode) query = query.eq("service_code", args.serviceCode);
    if (args.datasetCode) query = query.eq("source_service_concepts.dataset_code", args.datasetCode);
    if (args.conceptCode) query = query.eq("source_service_concepts.concept_code", args.conceptCode);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { results: data ?? [] };
  });
}

// ---------------------------------------------------------------------------
// Provider Search Tool: PostGIS search from the case's municipality representative point.
// The location never comes from (or goes to) the model; only distances are returned.
export async function searchProviders(ctx: ToolContext, serviceCodes: string[], radiusKm = 10) {
  const codes = serviceCodes.filter((c) => (SERVICE_CODES as readonly string[]).includes(c));
  return runTool(ctx, "search_providers", { serviceCodes: codes, radiusKm }, async () => {
    failIfDbFault(ctx);
    if (ctx.faults.has("providers_empty")) return { results: [], note: "該当する事業所が見つかりませんでした。" };
    if (!ctx.cityCode) return { results: [], note: "市区町村が登録されていないため検索できませんでした。" };
    const { data, error } = await ctx.sb.rpc("search_providers", {
      p_care_service_codes: codes,
      p_city_code: ctx.cityCode,
      p_radius_km: Math.min(Math.max(radiusKm, 1), 30),
      p_limit: 10,
    });
    if (error) throw new Error(error.message);
    return {
      results: data ?? [],
      distanceNote: "距離は市区町村の代表地点からの参考距離です（本人の住所からの距離ではありません）。",
    };
  });
}

// ---------------------------------------------------------------------------
// Document Search Tool: PGroonga full-text + pgvector (Gemini Embedding 2, 768 dims).
function genai() {
  // ADK and this module read the same server-side GEMINI_API_KEY; never exposed to the browser.
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function embedQuery(ctx: ToolContext, text: string): Promise<number[] | null> {
  const usage = await getUsage(ctx.sb, ctx.caseId);
  if (usage.gemini_request >= BUDGET.gemini_request || ctx.faults.has("gemini")) return null;
  await recordUsage(ctx.sb, ctx.caseId, "gemini_request", "embedding");
  try {
    const response = await genai().models.embedContent({
      model: MODELS.embedding,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_QUERY" },
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) return null;
    const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
    return values.map((v) => v / norm);
  } catch (error) {
    console.warn("query embedding failed; falling back to full-text only", error);
    return null;
  }
}

export async function searchDocuments(ctx: ToolContext, query: string) {
  const safeQuery = maskIdentity(query, ctx.identity).slice(0, 200);
  return runTool(ctx, "search_documents", { query: safeQuery }, async () => {
    failIfDbFault(ctx);
    const embedding = await embedQuery(ctx, safeQuery);
    const { data, error } = await ctx.sb.rpc("hybrid_search_documents", {
      p_query: safeQuery,
      p_query_embedding: embedding ? `[${embedding.join(",")}]` : null,
      p_limit: 4,
    });
    if (error) throw new Error(error.message);
    return { results: data ?? [], mode: embedding ? "hybrid" : "full_text_only" };
  });
}

// ---------------------------------------------------------------------------
// Web Search Tool (max 1 per case): Google Search + URL Context, official sources preferred.
const OFFICIAL_DOMAIN = /(\.go\.jp|\.lg\.jp|kaigokensaku\.mhlw\.go\.jp|mhlw\.go\.jp|city\.[a-z-]+\.[a-z]+\.jp)/;
const WEB_TIMEOUT_MS = 20000;

export async function searchOfficialWeb(ctx: ToolContext, query: string) {
  const safeQuery = maskIdentity(query, ctx.identity).slice(0, 200);
  return runTool(ctx, "search_official_web", { query: safeQuery }, async () => {
    const usage = await getUsage(ctx.sb, ctx.caseId);
    if (usage.web_search >= BUDGET.web_search) {
      return { available: false, reason: "web_search_budget_exhausted", results: [] };
    }
    if (usage.gemini_request >= BUDGET.gemini_request) {
      return { available: false, reason: "gemini_budget_exhausted", results: [] };
    }
    await recordUsage(ctx.sb, ctx.caseId, "web_search", safeQuery);
    await recordUsage(ctx.sb, ctx.caseId, "gemini_request", "web_search");
    try {
      if (ctx.faults.has("web")) throw new Error("Web検索に失敗しました（障害注入）");
      const response = await genai().models.generateContent({
        model: MODELS.webSearch,
        contents:
          `次の内容について、厚生労働省・自治体公式サイト・介護サービス情報公表システム・事業所公式サイトの情報を優先して確認し、` +
          `分かったことを日本語で3文以内に要約してください。一般ブログは使わないでください。\n内容: ${safeQuery}`,
        config: { tools: [{ googleSearch: {} }, { urlContext: {} }], abortSignal: AbortSignal.timeout(WEB_TIMEOUT_MS) },
      });
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "", domain: c.web?.domain ?? c.web?.title ?? "" }))
        .filter((s) => s.url)
        .map((s) => ({ ...s, official: OFFICIAL_DOMAIN.test(s.domain) || OFFICIAL_DOMAIN.test(s.title) }));
      return {
        available: true,
        summary: response.text ?? "",
        results: sources,
        note: "Web検索の要約はAIによるもので、公式情報の最終確認が必要です。",
      };
    } catch (error) {
      // Fallback: continue with DB information only.
      return { available: false, reason: error instanceof Error ? error.message : "web search failed", results: [] };
    }
  });
}

// ---------------------------------------------------------------------------
// FunctionTool wrappers for Agent② (Information Collection). The model only chooses what to look up.
export function createCollectionTools(getCtx: () => ToolContext) {
  return [
    new FunctionTool({
      name: "get_eligible_services",
      description: "登録済みのケース情報に対して、制度上の利用条件（デモ用簡略ルール）を評価します。引数はありません。",
      execute: () => getEligibleServices(getCtx()),
    }),
    new FunctionTool({
      name: "get_need_service_candidates",
      description: "生活上のニーズ（need code）に対応する介護サービス・相談先の候補を返します。",
      parameters: z.object({ needCodes: z.array(z.enum(NEED_CODES)).min(1) }),
      execute: ({ needCodes }) => getNeedServiceCandidates(getCtx(), needCodes),
    }),
    new FunctionTool({
      name: "query_stat_table",
      description:
        "公的統計を模倣したデモ集計表を1つだけ参照します。conditions にはその表自身の次元だけを指定できます。" +
        "表同士を組み合わせることはできません。結果は参考傾向であり推薦の根拠ではありません。",
      parameters: z.object({
        tableCode: z.enum(STAT_TABLE_CODES),
        conditions: z.record(z.string(), z.string()).describe("例: {\"care_level\": \"要介護2\"}"),
      }),
      execute: ({ tableCode, conditions }) => queryStatTable(getCtx(), tableCode, conditions),
    }),
    new FunctionTool({
      name: "map_service_concepts",
      description: "統計や事業所データのサービス区分と、正規化した介護サービスの対応関係（exact_match / broader_than 等）を返します。",
      parameters: z.object({
        datasetCode: z.enum(["K25", "C26", "P26", "S22"]).optional(),
        conceptCode: z.string().optional(),
        serviceCode: z.enum(SERVICE_CODES).optional(),
      }),
      execute: (args) => mapServiceConcepts(getCtx(), args),
    }),
    new FunctionTool({
      name: "search_providers",
      description: "ケースの市区町村の代表地点から、指定した介護サービスを提供する事業所を検索します。位置は指定しないでください。",
      parameters: z.object({
        serviceCodes: z.array(z.enum(SERVICE_CODES)).min(1),
        radiusKm: z.number().min(1).max(30).optional(),
      }),
      execute: ({ serviceCodes, radiusKm }) => searchProviders(getCtx(), serviceCodes, radiusKm),
    }),
    new FunctionTool({
      name: "search_documents",
      description: "制度説明・手続き・事業所紹介のデモ文書を検索します（全文検索＋ベクトル検索）。",
      parameters: z.object({ query: z.string().min(1).max(200) }),
      execute: ({ query }) => searchDocuments(getCtx(), query),
    }),
    new FunctionTool({
      name: "search_official_web",
      description:
        "DB内の情報だけでは分からない重要事項（自治体の手続き窓口など）がある場合だけ、公式Web情報を確認します。1相談につき1回まで。個人情報を含めないでください。",
      parameters: z.object({ query: z.string().min(1).max(200) }),
      execute: ({ query }) => searchOfficialWeb(getCtx(), query),
    }),
  ];
}
