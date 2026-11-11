// D-Human is for adults (DPDP Act: under-18s need verifiable parental
// consent, which we don't collect). Shared by onboarding, settings and the
// profile API so the rule can't drift between them.
export const MIN_AGE = 18;
export const MAX_AGE = 100;

export const birthYearOk = (year: number, thisYear = new Date().getFullYear()) =>
  Number.isInteger(year) && year >= thisYear - MAX_AGE && year <= thisYear - MIN_AGE;
