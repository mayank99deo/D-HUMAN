// App tokens never belong in a log line (A14, QA test 37). Nothing logs one today; our own
// log lines that could ever hold request-derived text pass it through scrubTokens. Only our
// call sites: the runtime's console is never wrapped, so every web function runs as before.

const TOKEN = /dht_[A-Za-z0-9_-]+/g;

export const scrubTokens = (text: string) => text.replace(TOKEN, "dht_[redacted]");
