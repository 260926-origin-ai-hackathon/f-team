import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCaseViewModel } from "@/lib/care-agent/view";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/api/cases/[caseId]">) {
  const { caseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  try {
    const view = await buildCaseViewModel(supabase, caseId);
    if (!view) return NextResponse.json({ error: "相談が見つかりません。" }, { status: 404 });
    return NextResponse.json(view);
  } catch (error) {
    console.error("load case failed", error);
    return NextResponse.json({ error: "相談の情報を読み込めませんでした。" }, { status: 500 });
  }
}
