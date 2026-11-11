// Cities that share one events search: satellite towns and other spellings map to
// their metro, so "Navi Mumbai", "Thane" and "Bombay" share Mumbai's search.
const METROS: Record<string, string[]> = {
  mumbai: ["mumbai", "bombay", "navi mumbai", "thane", "kalyan", "dombivli", "vasai", "virar", "mira road", "panvel", "bhiwandi"],
  "delhi ncr": ["delhi", "new delhi", "gurgaon", "gurugram", "noida", "greater noida", "ghaziabad", "faridabad", "dwarka"],
  bengaluru: ["bengaluru", "bangalore", "whitefield", "electronic city"],
  hyderabad: ["hyderabad", "secunderabad", "cyberabad", "gachibowli"],
  chennai: ["chennai", "madras", "tambaram", "avadi"],
  kolkata: ["kolkata", "calcutta", "howrah", "salt lake", "new town"],
  pune: ["pune", "pimpri", "chinchwad", "pimpri chinchwad", "hinjewadi"],
  ahmedabad: ["ahmedabad", "gandhinagar"],
  chandigarh: ["chandigarh", "mohali", "panchkula", "zirakpur"],
  kochi: ["kochi", "cochin", "ernakulam"],
};
const METRO_OF = new Map(Object.entries(METROS).flatMap(([metro, names]) => names.map((n) => [n, metro] as const)));

export function regionKey(city?: string | null, country?: string | null): string {
  const c = (city ?? "").trim().toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (c) return METRO_OF.get(c) ?? c;
  return (country?.trim() || "India").toLowerCase();
}
