// Runs once when a server instance starts (Next's instrumentation file).
export async function register() {
  // App tokens are redacted from every server log line (lib/auth/scrub.ts). Node only: the
  // scrubber uses node:util.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLogScrubber } = await import("./lib/auth/scrub");
    installLogScrubber();
  }
}
