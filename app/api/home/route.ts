import { viewResponse } from "@/lib/api/respond";
import { apiMember } from "@/lib/platform/api-member";
import { dashboard } from "@/lib/platform/dashboard";
import { homeJson } from "@/lib/api/views/home";
import { homeView } from "@/lib/platform/views/home";

// The apps' Home, from the same data and the same builder as the web's /home page
// (lib/platform/views/home.ts), so every verdict, doctor flag and stack line is the web's.
// 409 not_onboarded before onboarding. Private, no-store, with an ETag: a repeat with
// If-None-Match answers 304. Reads only; it never starts a search or a build.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  const data = await dashboard(member.user.id, member.profile, member.persona);
  return viewResponse(request, homeJson(homeView(member, data)));
}
