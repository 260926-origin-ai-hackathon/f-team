// Information already registered about the person (not facility-search preferences).
export type CareProfile = {
  id: string;
  display_name: string;
  age: number;
  gender: string;
  address: string;
  household: string;
  residence: string;
  emergency_contact: string;
  care_level: string;
  dementia: string;
  mobility: string;
  bathing: string;
  toileting: string;
  eating: string;
  medication: string;
  daytime_life: string;
  care_services: string;
  chronic_conditions: string;
  medications: string;
  medical_needs: string;
  allergies: string;
};

export const PROFILE_COLUMNS =
  "id, display_name, age, gender, address, household, residence, emergency_contact, care_level, dementia, mobility, bathing, toileting, eating, medication, daytime_life, care_services, chronic_conditions, medications, medical_needs, allergies";

export type Facility = {
  id: string;
  name: string;
  address: string;
  facility_type: string;
  monthly_fee_yen: number;
  entrance_fee_yen: number;
  accepted_care_levels: string;
  dementia_support: string;
  medical_support: string;
  private_room: boolean;
  rehabilitation: string;
  family_access: string;
  features: string;
};

// Question choices shared by the form (labels) and the API (validation).
export const AREA_OPTIONS = ["今の住まいの周辺", "大阪府北部ならどこでも", "こだわらない"] as const;

export const PRIORITY_OPTIONS = [
  "費用を抑えること",
  "家族が訪問しやすいこと",
  "医療・看護体制",
  "認知症ケア",
  "本人の生活の自由度・自立",
] as const;

export const BUDGET_OPTIONS = [150000, 180000, 200000, 220000, 250000, 300000] as const;

export const FAMILY_ACCESS_OPTIONS = ["とても重視する", "ある程度重視する", "あまり重視しない"] as const;

export const PRIVATE_ROOM_OPTIONS = ["必須", "できれば個室", "こだわらない"] as const;

export const CARE_SUPPORT_OPTIONS = [
  "24時間の手厚い見守り・看護を重視",
  "日中中心の見守りで十分",
  "最低限でよい",
] as const;

export const DESIRED_LIFE_MAX_LENGTH = 300;

export type Answers = {
  area: (typeof AREA_OPTIONS)[number];
  priority: (typeof PRIORITY_OPTIONS)[number];
  budgetMaxYen: (typeof BUDGET_OPTIONS)[number];
  familyAccess: (typeof FAMILY_ACCESS_OPTIONS)[number];
  privateRoom: (typeof PRIVATE_ROOM_OPTIONS)[number];
  careSupport: (typeof CARE_SUPPORT_OPTIONS)[number];
  desiredLife: string;
};

export type Recommendation = {
  facilityId: string;
  facilityName: string;
  facilityType: string;
  monthlyFeeYen: number;
  address: string;
  rank: number;
  fitSummary: string;
  reasons: string[];
  matches: string[];
  cautions: string[];
};

export type ExcludedFacility = {
  facilityId: string;
  facilityName: string;
  reason: string;
};

export type RecommendResult = {
  summary: string;
  totalFacilities: number;
  recommendations: Recommendation[];
  excluded: ExcludedFacility[];
  nextSteps: string[];
};

export function formatYen(yen: number) {
  return `${(yen / 10000).toLocaleString("ja-JP")}万円`;
}
