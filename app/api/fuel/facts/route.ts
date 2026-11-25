import { viewResponse } from "@/lib/api/respond";
import { factsJson } from "@/lib/api/views/fuel";
import { apiMember } from "@/lib/platform/api-member";

// The facts the meal wait screen shows, picked by the person's age, height, weight, diet and
// sex as Fuel's page picks them. Its own route because they rarely change: the app keeps them
// with their ETag. No AI, and no database work beyond the sign-in.
export async function GET(request: Request) {
  const member = await apiMember(request);
  if (!member.ok) return member.response;
  return viewResponse(request, factsJson(member));
}
