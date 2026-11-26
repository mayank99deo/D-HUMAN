// What the apps' sign-in says for each refusal. The first four are the web form's own words
// (components/platform/SignInForm.tsx); tests/app-auth.test.ts fails if the two drift apart.
export const SIGN_IN_WORDS = {
  invalid: "That code doesn't match. Check the latest email.",
  expired: "That code has expired. Ask for a new one.",
  locked: "Too many wrong tries for this code. Ask for a new one.",
  rate_limited: "Too many tries. Wait a few minutes, then ask for a new code.",
  not_for_browsers: "This sign-in is for the D-Human app. On the web, sign in at d-human.fit.",
} as const;
