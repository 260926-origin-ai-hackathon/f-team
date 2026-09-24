import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { PROFILE_COLUMNS, type CareProfile } from "@/lib/care/types";
import { FlowProvider } from "../_components/FlowProvider";

// Loads the registered demo profile once for all step pages.
export default async function FlowLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("care_profiles")
    .select(PROFILE_COLUMNS)
    .order("created_at")
    .limit(1)
    .maybeSingle<CareProfile>();

  return (
    <div className="flex min-h-dvh justify-center bg-emerald-50">
      {profile ? (
        <FlowProvider profile={profile}>{children}</FlowProvider>
      ) : (
        <p className="m-auto max-w-xs rounded-2xl bg-white p-6 text-center text-sm text-red-700 shadow">
          プロフィールを読み込めませんでした。時間をおいて再度お試しください。
        </p>
      )}
    </div>
  );
}
