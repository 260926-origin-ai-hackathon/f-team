import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recommendFacilities } from "@/lib/care/gemini";
import {
  AREA_OPTIONS,
  BUDGET_OPTIONS,
  CARE_SUPPORT_OPTIONS,
  DESIRED_LIFE_MAX_LENGTH,
  FAMILY_ACCESS_OPTIONS,
  PRIORITY_OPTIONS,
  PRIVATE_ROOM_OPTIONS,
  PROFILE_COLUMNS,
  type Answers,
  type CareProfile,
  type Facility,
} from "@/lib/care/types";

const FACILITY_COLUMNS =
  "id, name, address, facility_type, monthly_fee_yen, entrance_fee_yen, accepted_care_levels, dementia_support, medical_support, private_room, rehabilitation, family_access, features";

function oneOf<T>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

function parseAnswers(value: unknown): Answers | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const area = oneOf(AREA_OPTIONS, v.area);
  const priority = oneOf(PRIORITY_OPTIONS, v.priority);
  const budgetMaxYen = oneOf(BUDGET_OPTIONS, v.budgetMaxYen);
  const familyAccess = oneOf(FAMILY_ACCESS_OPTIONS, v.familyAccess);
  const privateRoom = oneOf(PRIVATE_ROOM_OPTIONS, v.privateRoom);
  const careSupport = oneOf(CARE_SUPPORT_OPTIONS, v.careSupport);
  if (!area || !priority || !budgetMaxYen || !familyAccess || !privateRoom || !careSupport) return null;
  const desiredLife = typeof v.desiredLife === "string" ? v.desiredLife.trim().slice(0, DESIRED_LIFE_MAX_LENGTH) : "";
  return { area, priority, budgetMaxYen, familyAccess, privateRoom, careSupport, desiredLife };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY が設定されていないため、AI推論を実行できません。" },
      { status: 503 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const profileId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).profileId : null;
  const answers = parseAnswers(typeof body === "object" && body !== null ? (body as Record<string, unknown>).answers : null);
  if (typeof profileId !== "string" || !answers) {
    return NextResponse.json({ error: "入力内容が正しくありません。" }, { status: 400 });
  }

  // Re-read everything from Supabase on the server; the client only sends the profile id and answers.
  const supabase = await createClient();
  const [profileResult, facilitiesResult] = await Promise.all([
    supabase.from("care_profiles").select(PROFILE_COLUMNS).eq("id", profileId).maybeSingle<CareProfile>(),
    supabase.from("facilities").select(FACILITY_COLUMNS).order("monthly_fee_yen").returns<Facility[]>(),
  ]);

  if (profileResult.error || facilitiesResult.error) {
    console.error("Supabase error", profileResult.error ?? facilitiesResult.error);
    return NextResponse.json({ error: "データの取得に失敗しました。" }, { status: 500 });
  }
  if (!profileResult.data) {
    return NextResponse.json({ error: "プロフィールが見つかりません。" }, { status: 404 });
  }
  if (!facilitiesResult.data?.length) {
    return NextResponse.json({ error: "施設データがありません。" }, { status: 500 });
  }

  try {
    const result = await recommendFacilities(apiKey, profileResult.data, answers, facilitiesResult.data);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Gemini error", error);
    return NextResponse.json(
      { error: "AIによる推論に失敗しました。時間をおいて再度お試しください。" },
      { status: 502 },
    );
  }
}
