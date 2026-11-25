import { viewResponse } from "@/lib/api/respond";
import { fuelJson } from "@/lib/api/views/fuel";
import { apiMember } from "@/lib/platform/api-member";
import { fuelData, fuelView } from "@/lib/platform/views/fuel";

// The apps' Fuel, from the same data and the same builder as the web's /fuel page
// (lib/platform/views/fuel.ts): today's totals against the person's targets, today's meals,
// the usual day, the food gaps and the plan. 409 not_onboarded before onboarding. Private,
// no-store, with an ETag (304 on a repeat). Reads only.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const data = await fuelData(member);
  return viewResponse(request, fuelJson(fuelView(member, data), data, member.profile.timezone));
}
