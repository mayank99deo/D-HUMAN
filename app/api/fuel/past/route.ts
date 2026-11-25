import { viewResponse } from "@/lib/api/respond";
import { pastData, pastJson } from "@/lib/api/views/fuel";
import { apiMember } from "@/lib/platform/api-member";

// The apps' Past meals: the 28 days before today that have meals, newest first, labelled as
// the web's /fuel/past labels them (lib/api/views/fuel.ts). Private, no-store, ETag. Reads only.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  return viewResponse(request, pastJson(member, await pastData(member.user.id, member.profile.timezone)));
}
