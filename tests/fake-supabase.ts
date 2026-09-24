import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * Minimal in-memory stand-in for the supabase-js query builder (select/eq/in/contains/order/limit,
 * maybeSingle/single, insert/upsert with ignoreDuplicates, rpc). Enough for tool/repo unit tests.
 */
export function fakeSupabase(tables: Tables, rpc: Record<string, (args: Row) => unknown> = {}, failTables: string[] = []) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const error: { message: string } | null = failTables.includes(table) ? { message: `${table} unavailable` } : null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, value: unknown) => ((rows = rows.filter((r) => r[col] === value)), builder),
      in: (col: string, values: unknown[]) => ((rows = rows.filter((r) => values.includes(r[col]))), builder),
      is: (col: string, value: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === value)), builder),
      gte: () => builder,
      order: () => builder,
      limit: (n: number) => ((rows = rows.slice(0, n)), builder),
      range: () => builder,
      contains: (col: string, value: Row) => (
        (rows = rows.filter((r) => Object.entries(value).every(([k, v]) => (r[col] as Row | undefined)?.[k] === v))), builder
      ),
      maybeSingle: async () => ({ data: error ? null : (rows[0] ?? null), error }),
      single: async () => ({ data: error ? null : rows[0], error: error ?? (rows[0] ? null : { message: "no rows" }) }),
      insert: (value: Row | Row[]) => {
        if (!error) (tables[table] ??= []).push(...(Array.isArray(value) ? value : [value]));
        return builder;
      },
      upsert: (value: Row | Row[], opts?: { onConflict?: string }) => {
        const keys = opts?.onConflict?.split(",") ?? [];
        for (const v of Array.isArray(value) ? value : [value]) {
          const exists = (tables[table] ??= []).some((r) => keys.length && keys.every((k) => r[k] === v[k]));
          if (!exists && !error) tables[table].push(v);
        }
        return builder;
      },
      update: () => builder,
      then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : rows, error, count: rows.length }),
    };
    return builder;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => ({ data: rpc[name]?.(args) ?? [], error: null }),
  };
  return client as unknown as SupabaseClient;
}
