import { inspect } from "node:util";

// App tokens never belong in a log line (A14, QA test 37). Nothing logs one today; this is
// the net under future mistakes. instrumentation.ts installs it once per server instance:
// every console call is checked, and only an argument that holds `dht_…` is rewritten, so
// every other log line reaches the logs exactly as before.

const TOKEN = /dht_[A-Za-z0-9_-]+/g;

export const scrubTokens = (text: string) => text.replace(TOKEN, "dht_[redacted]");

/** The argument as it was, or, if it holds a token anywhere, its text with the token redacted. */
export function scrubbed(arg: unknown): unknown {
  if (typeof arg === "string") return arg.includes("dht_") ? scrubTokens(arg) : arg;
  if (arg === null || (typeof arg !== "object" && typeof arg !== "function")) return arg;
  const text = inspect(arg, { depth: 6 });
  return text.includes("dht_") ? scrubTokens(text) : arg;
}

const METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;
type Marked = Console & { __dhumanScrubbed?: true };

export function installLogScrubber(target: Console = console): void {
  const marked = target as Marked;
  if (marked.__dhumanScrubbed) return;
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(scrubbed));
  }
  marked.__dhumanScrubbed = true;
}
