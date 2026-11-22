// The voice engine (components/platform/voice-engine.ts) against stand-ins for WebKit and
// Chrome, on a simulated clock.
//
// The bug these guard (Mayank, 2026-11-22, iPhone 17, the Google app's browser on 5G): voice
// went wrong part-way through a visit and stayed wrong until the tab was closed. Found:
// - A passing failure was remembered for the whole visit. On iPhone, Apple's speech service
//   becoming unreachable for a moment (a weak signal) is `service-not-allowed`, the same
//   code as "can't transcribe this language". After English had listened, that read as the
//   language: हिंदी (and Hinglish with it) then said "This browser can't listen" without
//   asking the engine again, in Fuel and in Ask, until the tab closed.
// - After an abort (Edit, Close, a log), the next start didn't wait for the old recogniser to
//   let go. WebKit's server then sets the NEW recogniser inactive (SpeechRecognitionServer.cpp:
//   an End queues setInactive() on whatever recogniser is current), and it ignores stop and
//   abort and keeps the mic on until the next start.
// - Ask's mic ignored a tap while a stop was finishing, and only cancelled a slow start.
//
// The WebKit stand-in follows its sources (copies in the session scratchpad, webkit/*):
// SpeechRecognition.cpp (states; an error makes it inactive with no `end`), the permission
// manager (one check at a time; an unsupported or unreachable locale fails there), the
// server (one current recogniser; End and Error queue follow-ups on whatever is current) and
// WebSpeechRecognizerTask.mm (cancel and finish end later; availability lost mid-session).
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const session = new MemoryStorage();
Object.assign(globalThis, { sessionStorage: session, localStorage: new MemoryStorage(), window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} } });

allowAppImports();
const { VoiceEngine, HANDOVER_MS } = await import("../components/platform/voice-engine.ts");
const L = await import("../components/platform/listen-state.ts");
const P = await import("../components/platform/spoken-pick.ts");
const A = await import("../components/platform/ask-mic.ts");
const { spokenById } = await import("../lib/domain/speech.ts");
type Mic = import("../components/platform/listen-state.ts").Mic;
type MicProblem = import("../components/platform/listen-state.ts").MicProblem;
type Recognition = import("../components/platform/voice-engine.ts").Recognition;
type RecognitionCtor = import("../components/platform/voice-engine.ts").RecognitionCtor;

const en = spokenById("en");
const hi = spokenById("hi");
const hinglish = spokenById("hinglish");
const ta = spokenById("ta");

// ── A clock that runs scheduled work in order ─────────────────────────────
class Clock {
  t = 0;
  private seq = 0;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  after = (fn: () => void, ms: number) => void this.q.push({ at: this.t + ms, seq: this.seq++, fn });
  run(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

type Row = [string, boolean];
const rowsOf = (rows: Row[]) => rows.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }));
const WORDS: Record<string, string> = { "en-IN": "two rotis and dal", "hi-IN": "दो रोटी और दाल" };

/** The page's side: what a script holds. Shared by both stand-ins. */
class PageRecognition implements Recognition {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: Recognition["onresult"] = null;
  onend: Recognition["onend"] = null;
  onerror: Recognition["onerror"] = null;
  onstart: Recognition["onstart"] = null;
  onaudiostart: Recognition["onaudiostart"] = null;
  onsoundstart: Recognition["onsoundstart"] = null;
  onspeechstart: Recognition["onspeechstart"] = null;
  onspeechend: Recognition["onspeechend"] = null;
  start() {}
  stop() {}
  abort() {}
}

// ── WebKit ───────────────────────────────────────────────────────────────
type Update = { type: "start" | "audiostart" | "speechstart" | "result" | "error" | "end"; error?: string; rows?: Row[] };

class WebKit {
  /** Locales the phone can transcribe, and those whose service can't be reached right now. */
  supported = new Set(["en-IN", "hi-IN"]);
  unreachable = new Set<string>();
  permissionMs = 40;
  cancelMs = 60;
  finishMs = 250;
  /** The permission step's head never answers. */
  hang = false;
  starts: string[] = [];
  /** End updates whose setInactive() landed on a newer recogniser. */
  races = 0;
  /** Recognisers set inactive while still capturing: they ignore stop and abort. */
  zombies = 0;
  current: ServerRecognizer | null = null;
  private pending = new Map<number, string>();
  private queue: number[] = [];
  private clients = new Map<number, WebKitRecognition>();
  private nextId = 1;
  readonly clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }

  ctor(): RecognitionCtor {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const wk = this;
    return function () {
      return new WebKitRecognition(wk);
    } as unknown as RecognitionCtor;
  }
  register(c: WebKitRecognition) {
    const id = this.nextId++;
    this.clients.set(id, c);
    return id;
  }
  available = (lang: string) => this.supported.has(lang) && !this.unreachable.has(lang);
  send(id: number, u: Update) {
    this.clock.after(() => this.clients.get(id)?.update(u), 4);
  }
  /** The server's delegate callback: send, then queue the follow-up on whatever recogniser is current then. */
  callback(id: number, u: Update) {
    this.send(id, u);
    if (u.type === "error") this.clock.after(() => this.current?.abort(), 0);
    if (u.type === "end")
      this.clock.after(() => {
        const c = this.current;
        if (!c || c.state === "inactive") return;
        if (c.id !== id) this.races++;
        c.setInactive();
      }, 0);
  }
  start(id: number, lang: string) {
    this.pending.set(id, lang);
    this.queue.push(id);
    if (this.queue.length === 1) this.nextPermission();
  }
  nextPermission() {
    while (this.queue.length && !this.pending.has(this.queue[0])) this.queue.shift();
    const id = this.queue[0];
    if (id == null || this.hang) return;
    this.clock.after(() => {
      this.queue.shift();
      const lang = this.pending.get(id);
      if (lang != null) {
        this.pending.delete(id);
        if (!this.available(lang)) this.send(id, { type: "error", error: "service-not-allowed" });
        else this.handle(id, lang);
      }
      this.nextPermission();
    }, this.permissionMs);
  }
  unhang() {
    this.hang = false;
    this.nextPermission();
  }
  handle(id: number, lang: string) {
    const old = this.current;
    if (old) {
      old.abort({ type: "error", error: "aborted" });
      old.prepareForDestruction();
      // Replaced: destroyed, so its task's late callbacks reach nothing (a weak pointer in WebKit).
      old.destroyed = true;
    }
    this.current = new ServerRecognizer(this, id, lang);
    this.current.start();
  }
  stop(id: number) {
    if (this.pending.delete(id)) return this.send(id, { type: "end" });
    if (this.current?.id === id) this.current.stop();
  }
  abort(id: number) {
    if (this.pending.delete(id)) return this.send(id, { type: "end" });
    if (this.current?.id === id) this.current.abort();
  }
  /** Apple's service goes away mid-session (WebSpeechRecognizerTask.mm, availabilityDidChange). */
  dropService() {
    const c = this.current;
    if (c?.state === "running") c.send({ type: "error", error: "service-not-allowed" });
  }
}

class ServerRecognizer {
  state: "inactive" | "running" | "stopping" | "aborting" = "inactive";
  capturing = false;
  private gen = 0;
  private cb: (u: Update) => void;
  private wk: WebKit;
  readonly id: number;
  private lang: string;
  constructor(wk: WebKit, id: number, lang: string) {
    this.wk = wk;
    this.id = id;
    this.lang = lang;
    this.cb = (u) => wk.callback(id, u);
  }
  destroyed = false;
  private ended = false;
  send(u: Update) {
    if (this.destroyed) return;
    // One end per task (WebSpeechRecognizerTask.mm, _hasSentEnd); a cancelled task reports nothing more.
    if (u.type === "end") {
      if (this.ended) return;
      this.ended = true;
    } else if (this.ended && u.type === "result") return;
    this.cb(u);
  }
  start() {
    if (!this.wk.available(this.lang)) return this.send({ type: "error", error: "service-not-allowed" });
    this.state = "running";
    this.send({ type: "start" });
    this.capturing = true;
    this.send({ type: "audiostart" });
    const g = this.gen;
    const w = WORDS[this.lang] ?? "two rotis";
    const later = (ms: number, u: Update) => this.wk.clock.after(() => this.capturing && this.gen === g && this.send(u), ms);
    later(300, { type: "speechstart" });
    later(400, { type: "result", rows: [[w.split(" ").slice(0, 2).join(" "), false]] });
    later(800, { type: "result", rows: [[w, true]] });
  }
  private stopCapture() {
    this.gen++;
    this.capturing = false;
  }
  abort(error?: Update) {
    if (this.state === "aborting" || this.state === "inactive") return;
    this.state = "aborting";
    if (error) this.send(error);
    this.stopCapture();
    this.wk.clock.after(() => this.send({ type: "end" }), this.wk.cancelMs);
  }
  stop() {
    if (this.state === "aborting" || this.state === "inactive") return;
    this.state = "stopping";
    this.stopCapture();
    const w = WORDS[this.lang] ?? "two rotis";
    this.wk.clock.after(() => {
      this.send({ type: "result", rows: [[`${w}.`, true]] });
      this.send({ type: "end" });
    }, this.wk.finishMs);
  }
  prepareForDestruction() {
    if (this.state === "inactive") {
      if (this.capturing) {
        this.stopCapture();
        this.wk.zombies--;
      }
      return;
    }
    const cb = this.cb;
    this.cb = () => {};
    cb({ type: "end" });
    this.state = "inactive";
  }
  setInactive() {
    if (this.capturing) this.wk.zombies++;
    this.state = "inactive";
  }
}

class WebKitRecognition extends PageRecognition {
  private state: "inactive" | "starting" | "running" | "stopping" | "aborting" = "inactive";
  private finals: Row[] = [];
  private id: number;
  private wk: WebKit;
  constructor(wk: WebKit) {
    super();
    this.wk = wk;
    this.id = wk.register(this);
  }
  start() {
    if (this.state !== "inactive") throw new Error("InvalidStateError: Recognition is being started or already started");
    this.wk.starts.push(this.lang);
    this.wk.start(this.id, this.lang);
    this.state = "starting";
  }
  stop() {
    if (this.state === "inactive" || this.state === "stopping" || this.state === "aborting") return;
    this.wk.stop(this.id);
    this.state = "stopping";
  }
  abort() {
    if (this.state === "inactive" || this.state === "aborting") return;
    this.wk.abort(this.id);
    this.state = "aborting";
  }
  update(u: Update) {
    const fire = (fn: () => void) => this.wk.clock.after(fn, 0);
    if (u.type === "start") {
      if (this.state === "starting") this.state = "running";
      return fire(() => this.onstart?.());
    }
    if (u.type === "audiostart") return fire(() => this.onaudiostart?.());
    if (u.type === "speechstart") return fire(() => this.onspeechstart?.());
    if (u.type === "error") {
      this.finals = [];
      this.state = "inactive";
      return fire(() => this.onerror?.({ error: u.error! }));
    }
    if (u.type === "end") {
      this.finals = [];
      this.state = "inactive";
      return fire(() => this.onend?.());
    }
    const rows = u.rows ?? [];
    const all = [...this.finals, ...rows];
    this.finals.push(...rows.filter(([, f]) => f));
    fire(() => this.onresult?.({ results: rowsOf(all) }));
  }
}

// ── Chrome: an error, then an end; abort is "aborted" then end ────────────
class Chrome {
  supported = new Set(["en-IN", "hi-IN"]);
  starts: string[] = [];
  readonly clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }
  ctor(): RecognitionCtor {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const c = this;
    return function () {
      return new ChromeRecognition(c);
    } as unknown as RecognitionCtor;
  }
}
class ChromeRecognition extends PageRecognition {
  private on = false;
  private ending = false;
  private gen = 0;
  private c: Chrome;
  constructor(c: Chrome) {
    super();
    this.c = c;
  }
  private later(ms: number, fn: () => void) {
    const g = this.gen;
    this.c.clock.after(() => g === this.gen && fn(), ms);
  }
  private finish(error?: string) {
    this.gen++;
    if (error) this.onerror?.({ error });
    this.onend?.();
    this.on = false;
  }
  start() {
    if (this.on) throw new Error("InvalidStateError");
    this.on = true;
    this.ending = false;
    this.c.starts.push(this.lang);
    if (!this.c.supported.has(this.lang)) return this.later(20, () => this.finish("language-not-supported"));
    const w = WORDS[this.lang] ?? "two rotis";
    this.later(50, () => {
      this.onstart?.();
      this.onaudiostart?.();
    });
    this.later(300, () => this.onresult?.({ results: rowsOf([[w.split(" ").slice(0, 2).join(" "), false]]) }));
    this.later(600, () => this.onresult?.({ results: rowsOf([[w, true]]) }));
  }
  stop() {
    if (!this.on || this.ending) return;
    this.ending = true;
    this.gen++;
    const w = WORDS[this.lang] ?? "two rotis";
    this.later(30, () => {
      this.onresult?.({ results: rowsOf([[`${w}.`, true]]) });
      this.finish();
    });
  }
  abort() {
    if (!this.on || this.ending) return;
    this.ending = true;
    this.gen++;
    this.later(10, () => this.finish("aborted"));
  }
}

// ── One listening control on a stand-in browser ──────────────────────────
function control(kind: "webkit" | "chrome") {
  const clock = new Clock();
  const browser = kind === "webkit" ? new WebKit(clock) : new Chrome(clock);
  const net = { online: true };
  const seen = { off: [] as (MicProblem | null)[], heard: [] as string[], live: 0 };
  const quiet = { note() {}, reset() {}, captureFailed() {} };
  const engine = new VoiceEngine(
    { ctor: () => browser.ctor(), online: () => net.online, now: () => clock.t, after: clock.after, record: { read: P.voiceRecord, listened: P.noteListened, cantListen: P.noteCantListen } },
    quiet,
  );
  engine.setHandlers({ onLive: () => seen.live++, onHeard: (h) => seen.heard.push(L.heardText(h)), onOff: (p) => seen.off.push(p) });
  // The hook's 250 ms clock.
  const tick = () => {
    engine.tick();
    clock.after(tick, 250);
  };
  clock.after(tick, 250);
  return { clock, browser, net, seen, engine, run: (ms: number) => clock.run(ms), mic: (): Mic => engine.mic };
}
const webkit = () => {
  const c = control("webkit");
  return { ...c, wk: c.browser as WebKit };
};

beforeEach(() => session.clear());

describe("what a failure means", () => {
  const sna = (lang: Parameters<typeof L.micProblemOf>[1]["lang"], workedIn: Parameters<typeof L.micProblemOf>[1]["workedIn"] = [], more = {}) =>
    L.micProblemOf("service-not-allowed", { lang, workedIn, ...more });

  it("never reads a passing loss of Apple's service as the language", () => {
    for (const lang of ["en", "hinglish", "hi", "ta", "bn"] as const) {
      // During a session the language was already accepted ("becomes unavailable").
      assert.equal(sna(lang, [], { live: true }), "stopped", `${lang} live`);
      assert.equal(sna(lang, ["en"], { live: true }), "stopped", `${lang} live, English worked`);
      // Offline: it's the connection.
      assert.equal(sna(lang, ["en"], { online: false }), "offline", `${lang} offline`);
      // This engine listened earlier this visit: the language is fine.
      assert.equal(sna(lang, [lang]), "stopped", `${lang} listened before`);
    }
    // Mayank's case: English listened, then हिंदी (or Hinglish) met a weak signal. Whichever tag Hinglish uses.
    for (const lang of ["en", "hinglish", "hi"] as const) for (const worked of ["en", "hinglish", "hi"] as const) assert.equal(sna(lang, [worked]), "stopped", `${lang} after ${worked}`);
  });

  it("still knows a language the phone can't transcribe, and Dictation switched off", () => {
    assert.equal(sna("ta"), "language");
    assert.equal(sna("bn", ["en"]), "language");
    assert.equal(sna("en"), "dictation_off", "nothing has listened yet: Dictation may be off");
    assert.equal(L.micProblemOf("language-not-supported", { lang: "ta", workedIn: [] }), "language");
    assert.equal(L.micProblemOf("network", { lang: "en", workedIn: ["en"], live: true }), "offline");
  });
});

describe("the engine on WebKit", () => {
  it("Mayank's case: a weak signal on हिंदी or Hinglish doesn't make it 'can't listen' for the rest of the visit", () => {
    for (const s of [hi, hinglish]) {
      session.clear();
      const t = webkit();
      t.engine.start(en);
      t.run(1500);
      assert.equal(t.mic().kind, "live");
      t.engine.abort();
      t.run(300);
      // The service can't be reached when the next pick starts.
      t.wk.unreachable.add(s.speech);
      t.engine.start(s);
      t.run(500);
      assert.deepEqual(t.mic(), { kind: "off", problem: "stopped" }, s.id);
      assert.deepEqual(P.voiceRecord().off, [], `${s.id}: nothing ruled out`);
      // The signal is back: the same pick reaches the engine and listens.
      t.wk.unreachable.clear();
      const n = t.wk.starts.length;
      t.engine.start(s);
      t.run(1500);
      assert.equal(t.wk.starts.length, n + 1, `${s.id} handed to the engine again`);
      assert.equal(t.mic().kind, "live", s.id);
    }
  });

  it("losing the service mid-session says it stopped, keeps nothing on the can't list, and listens next time", () => {
    const t = webkit();
    t.engine.start(en);
    t.run(1200);
    t.engine.abort();
    t.run(300);
    t.engine.start(hi);
    t.run(1200);
    assert.equal(t.mic().kind, "live");
    t.wk.dropService();
    t.run(100);
    assert.deepEqual(t.mic(), { kind: "off", problem: "stopped" });
    assert.deepEqual(P.voiceRecord().off, []);
    t.run(1000);
    t.engine.start(hi);
    t.run(1200);
    assert.equal(t.mic().kind, "live");
    assert.equal(t.wk.races + t.wk.zombies, 0);
  });

  it("rules out a language the phone can't do, and a pick of it by hand tries again", () => {
    const t = webkit();
    t.engine.start(en);
    t.run(1200);
    t.engine.start(ta);
    t.run(800);
    assert.deepEqual(t.mic(), { kind: "off", problem: "language" });
    assert.deepEqual(P.voiceRecord().off, ["ta"]);
    const n = t.wk.starts.length;
    t.engine.start(ta);
    t.run(300);
    assert.equal(t.wk.starts.length, n, "not handed to the engine again by itself");
    assert.deepEqual(t.mic(), { kind: "off", problem: "language" });
    P.forgetCantListen("ta");
    t.engine.start(ta);
    t.run(300);
    assert.equal(t.wk.starts.length, n + 1, "their own pick reaches the engine");
  });

  it("Edit during the countdown, then Talk again at once: the new mic waits for the old to let go, so stop still works", () => {
    for (const cancelMs of [60, 600]) {
      const t = webkit();
      t.wk.cancelMs = cancelMs;
      t.engine.start(en);
      t.run(1500);
      assert.equal(t.seen.heard.at(-1), "two rotis and dal");
      t.engine.abort(); // Edit, while the pause's countdown runs and the mic is still on
      t.run(250);
      t.engine.start(en); // Talk again
      t.run(1500);
      assert.equal(t.mic().kind, "live", `cancel ${cancelMs} ms`);
      assert.equal(t.wk.races, 0, `cancel ${cancelMs} ms: no setInactive race`);
      assert.equal(t.wk.zombies, 0);
      t.engine.stop(); // Done
      t.run(t.wk.finishMs + 50);
      assert.deepEqual(t.mic(), { kind: "off", problem: null }, "the stop is confirmed by the engine, not given up on");
    }
  });

  it("Done, then Keep talking before the last words land: waits for the end, and listens again", () => {
    const t = webkit();
    t.wk.finishMs = 700;
    t.engine.start(en);
    t.run(1200);
    t.engine.stop();
    t.run(200);
    t.engine.start(en); // aborts the one still finishing, then waits for its end
    t.run(30);
    assert.equal(t.wk.starts.length, 1, "not yet: the first hasn't let go");
    t.run(1500);
    assert.equal(t.wk.starts.length, 2);
    assert.equal(t.mic().kind, "live");
    assert.equal(t.wk.races + t.wk.zombies, 0);
  });

  it("an engine that never lets go delays the next start by HANDOVER_MS at most, and the start after that clears it", () => {
    const t = webkit();
    t.wk.cancelMs = 5000; // far longer than any wait
    t.engine.start(en);
    t.run(1200);
    t.engine.abort();
    t.run(100);
    t.engine.start(en);
    t.run(HANDOVER_MS - 50);
    assert.equal(t.wk.starts.length, 1);
    t.run(1500);
    assert.equal(t.wk.starts.length, 2, "started after the wait");
    assert.equal(t.mic().kind, "live");
    // WebKit's race hit it: it ignores stop. The session still ends, keeping the words.
    assert.equal(t.wk.zombies, 1);
    t.engine.stop();
    t.run(L.STOP_GRACE_MS + 300);
    assert.deepEqual(t.mic(), { kind: "off", problem: null });
    t.engine.start(en);
    t.run(HANDOVER_MS + 1500);
    assert.equal(t.mic().kind, "live");
    assert.equal(t.wk.zombies, 0, "the next start freed the mic");
  });

  it("a failure before the start leaves nothing to wait for: Try again goes at once", () => {
    const t = webkit();
    t.wk.unreachable.add("hi-IN");
    t.engine.start(hi);
    t.run(300);
    assert.equal(t.mic().kind, "off");
    t.wk.unreachable.clear();
    t.engine.start(hi);
    assert.equal(t.wk.starts.length, 2, "launched in the same tap");
  });

  it("two picks in a row: only the last reaches the engine", () => {
    const t = webkit();
    t.engine.start(en);
    t.run(1200);
    t.engine.start(hi);
    t.engine.start(en);
    t.run(1500);
    assert.deepEqual(t.wk.starts, ["en-IN", "en-IN"]);
    assert.equal(t.mic().kind, "live");
    assert.equal(t.wk.races + t.wk.zombies, 0);
  });

  it("a start that never comes is slow after 4 s; a fresh start listens once the browser answers", () => {
    const t = webkit();
    t.wk.hang = true;
    t.engine.start(en);
    t.run(L.START_SLOW_MS + 300);
    assert.deepEqual(t.mic(), { kind: "starting", since: 0, slow: true });
    t.engine.start(en); // Try again
    t.run(500);
    assert.equal(t.mic().kind, "starting", "behind the stuck permission check");
    t.wk.unhang();
    t.run(1500);
    assert.equal(t.mic().kind, "live");
    assert.equal(t.seen.live, 1);
  });

  it("offline before starting doesn't ask the engine, and isn't remembered", () => {
    const t = webkit();
    t.net.online = false;
    t.engine.start(hi);
    assert.deepEqual(t.mic(), { kind: "off", problem: "offline" });
    assert.equal(t.wk.starts.length, 0);
    assert.deepEqual(P.voiceRecord().off, []);
  });
});

describe("the engine on Chrome", () => {
  it("Edit then Talk again starts as soon as the old one ends", () => {
    const t = control("chrome");
    t.engine.start(en);
    t.run(900);
    t.engine.abort();
    t.engine.start(en);
    t.run(30);
    assert.equal((t.browser as Chrome).starts.length, 2, "Chrome lets go in milliseconds");
    t.run(800);
    assert.equal(t.mic().kind, "live");
    t.engine.stop();
    t.run(100);
    assert.deepEqual(t.mic(), { kind: "off", problem: null });
    assert.equal(t.seen.heard.at(-1), "two rotis and dal.");
  });

  it("language-not-supported is remembered for the visit", () => {
    const t = control("chrome");
    t.engine.start(ta);
    t.run(100);
    assert.deepEqual(t.mic(), { kind: "off", problem: "language" });
    assert.deepEqual(P.voiceRecord().off, ["ta"]);
  });
});

describe("a pick by hand", () => {
  it("clears that language, and every pick listening the same way, from the can't list", () => {
    P.noteCantListen("ta");
    P.noteCantListen("hinglish");
    P.forgetCantListen("ta");
    assert.deepEqual(P.voiceRecord().off, ["hinglish"]);
    // Whichever tag Hinglish uses, a pick sharing it is cleared with it.
    const twin = (["en", "hi"] as const).find((id) => L.sameEngine(id, "hinglish"))!;
    P.forgetCantListen(twin);
    assert.deepEqual(P.voiceRecord().off, []);
    P.forgetCantListen("bn");
    assert.deepEqual(P.voiceRecord().off, [], "nothing to forget is no change");
  });
});

describe("Ask's mic", () => {
  const starting: Mic = { kind: "starting", since: 0, slow: false };
  const slow: Mic = { kind: "starting", since: 0, slow: true };
  const live: Mic = { kind: "live", since: 0, heardAt: 400, quiet: false };
  const stopping: Mic = { kind: "stopping", since: 0, problem: null };
  it("a tap stops it while it listens, cancels a fresh start, and otherwise listens (again)", () => {
    assert.equal(A.askMicTap(live), "stop");
    assert.equal(A.askMicTap(starting), "cancel");
    assert.equal(A.askMicTap(slow), "listen", "slow to start: a fresh recogniser, like Fuel's Try again");
    assert.equal(A.askMicTap(stopping), "listen", "the last words are landing: they've more to say");
    assert.equal(A.askMicTap(L.MIC_OFF), "listen");
  });
  it("names what a tap does", () => {
    assert.equal(A.askMicLabel(live), "Done speaking");
    assert.equal(A.askMicLabel(starting), "Getting your mic");
    assert.equal(A.askMicLabel(slow), "Try the mic again");
    assert.equal(A.askMicLabel(stopping), "Speak your question");
  });
  it("says the browser will ask for the mic while it starts, then offers a way out", () => {
    const line = (mic: Mic, prompt: boolean) => A.askMicLine({ mic, note: null, spoken: en, off: [], limit: false, prompt });
    assert.deepEqual(line(starting, true), { kind: "starting", text: "Your browser will ask to use the microphone. Choose Allow." });
    assert.deepEqual(line(starting, false), { kind: "starting", text: "Getting your mic…" });
    assert.deepEqual(line(slow, true), { kind: "starting", text: "Still getting your mic. Tap it to try again, or type your question." });
  });
});
