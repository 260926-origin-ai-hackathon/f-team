import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CaseLimitError, createCaseFromTemplate } from "@/lib/care-agent/repo";

export const runtime = "nodejs";

// Creates a new consultation case for the signed-in (anonymous) user from the demo template.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  try {
    const caseId = await createCaseFromTemplate(supabase);
    return NextResponse.json({ caseId });
  } catch (error) {
    if (error instanceof CaseLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    console.error("create case failed", error);
    return NextResponse.json({ error: "相談を開始できませんでした。時間をおいてお試しください。" }, { status: 500 });
  }
}
