import { publicView } from "@/lib/api/respond";
import { optionsJson } from "@/lib/api/views/app";

// Every list onboarding and Settings show (activities, levels, goals, diets, conditions, sexes,
// languages, budgets), with ids and labels, so a new sport reaches the apps with no release. Not
// personal and needs no sign-in: public for an hour, with an ETag.
export async function GET(request: Request) {
  return publicView(request, optionsJson(), 3600);
}
