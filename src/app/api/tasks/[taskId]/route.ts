import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateTaskStatus } from "@/lib/care-agent/repo";

export const runtime = "nodejs";

const STATUSES = new Set(["todo", "in_progress", "done"]);

// Task status changes are plain CRUD outside the ADK workflow.
export async function PATCH(request: Request, { params }: RouteContext<"/api/tasks/[taskId]">) {
  const { taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { status?: string } | null;
  if (!body?.status || !STATUSES.has(body.status)) return NextResponse.json({ error: "状態が正しくありません。" }, { status: 400 });
  try {
    const task = await updateTaskStatus(supabase, taskId, body.status as "todo" | "in_progress" | "done");
    if (!task) return NextResponse.json({ error: "タスクが見つかりません。" }, { status: 404 });
    return NextResponse.json({ id: task.id, status: task.status });
  } catch (error) {
    console.error("update task failed", error);
    return NextResponse.json({ error: "タスクを更新できませんでした。" }, { status: 500 });
  }
}
