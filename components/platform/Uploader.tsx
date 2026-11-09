"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Fact } from "@/lib/domain/facts";
import { Orbit, type Stage } from "./Orbit";
import { shrinkImage } from "./shrink";

const MAX_TOTAL = 4 * 1024 * 1024;
const MAX_FILES = 6;

const ERRORS: Record<string, string> = {
  too_large: "That's over 4 MB. Upload photos of the pages instead, or ask your lab for a smaller PDF.",
  too_many_files: "Up to 6 photos per report.",
  unsupported_type: "Use a PDF, or JPEG, PNG or WebP photos.",
  one_pdf: "Upload one PDF on its own, or photos without a PDF.",
  rate_limited: "That's a lot of reports in an hour. Try again a little later.",
  not_onboarded: "Finish setting up your profile first.",
  no_file: "Choose a file first.",
};

type Picked = { name: string; file: File; preview?: string };
type StatusUpdate = { stage: Stage; error?: string | null };

// Asks the server how a report's read is going until it's ready or has failed.
async function pollReport(id: string, onUpdate: (u: StatusUpdate) => void, life: { alive: boolean }) {
  for (let i = 0; i < 200 && life.alive; i++) {
    const res = await fetch(`/api/reports/${id}`, { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    if (!life.alive) return;
    if (data?.status === "ready") return onUpdate({ stage: "done" });
    if (data?.status === "failed") return onUpdate({ stage: "error", error: data.error ?? null });
    if (data?.stage) onUpdate({ stage: data.stage as Stage });
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export function Uploader({ facts, noun, target, watchId, aiOff }: { facts: Fact[]; noun: string; target: string | null; watchId: string | null; aiOff: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [stage, setStage] = useState<Stage | null>(watchId ? "reading" : null);
  const [found, setFound] = useState<string[]>([]);
  const [reportId, setReportId] = useState<string | null>(watchId);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const total = picked.reduce((t, p) => t + p.file.size, 0);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setPreparing(true);
    const next: Picked[] = [];
    for (const f of Array.from(list)) {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
        next.push({ name: f.name, file: f });
        continue;
      }
      try {
        const small = await shrinkImage(f, 2200, 0.86);
        next.push({ name: f.name, file: small, preview: URL.createObjectURL(small) });
      } catch {
        setError(`We couldn't open ${f.name}. Use a JPEG or PNG photo, or the PDF.`);
      }
    }
    setPreparing(false);
    setPicked((cur) => {
      const merged = next.some((p) => p.file.type === "application/pdf") ? next.filter((p) => p.file.type === "application/pdf").slice(0, 1) : [...cur.filter((p) => p.file.type !== "application/pdf"), ...next];
      return merged.slice(0, MAX_FILES);
    });
  }

  const onStatus = useCallback((u: StatusUpdate) => {
    if (u.error !== undefined) setFailMessage(u.error);
    setStage(u.stage);
  }, []);
  const poll = useCallback((id: string) => pollReport(id, onStatus, { alive: true }), [onStatus]);

  // Reads the newline-delimited progress stream from the server.
  async function consume(res: Response) {
    let id: string | null = null;
    let finished = false;
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "created") {
            id = ev.reportId;
            setReportId(ev.reportId);
          } else if (ev.type === "stage") setStage(ev.stage);
          else if (ev.type === "marker") setFound((f) => (f.includes(ev.name) ? f : [...f, ev.name]));
          else if (ev.type === "done") {
            finished = true;
            setStage("done");
          } else if (ev.type === "error") {
            finished = true;
            setFailMessage(ev.message);
            setStage("error");
          }
        }
      }
    } catch {
      /* the connection dropped; fall back to polling below */
    }
    if (!finished && id) await poll(id);
  }

  async function start() {
    if (!picked.length) return;
    if (total > MAX_TOTAL) return setError(ERRORS.too_large);
    setError(null);
    setFound([]);
    setFailMessage(null);
    setStage("uploading");
    const form = new FormData();
    for (const p of picked) form.append("files", p.file, p.name);
    const res = await fetch("/api/reports", { method: "POST", body: form }).catch(() => null);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setStage(null);
      return setError(ERRORS[data.error] ?? "The upload didn't go through. Check your connection and try again.");
    }
    await consume(res);
  }

  async function retry() {
    if (!reportId) return;
    setFound([]);
    setFailMessage(null);
    setStage("reading");
    const res = await fetch(`/api/reports/${reportId}/retry`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setStage("error");
      return setFailMessage("We couldn't restart the read. Try again in a minute.");
    }
    await consume(res);
  }

  useEffect(() => {
    if (!watchId) return;
    const life = { alive: true };
    pollReport(watchId, onStatus, life);
    return () => {
      life.alive = false;
    };
  }, [watchId, onStatus]);

  // Once the read is in, take them to it.
  useEffect(() => {
    if (stage !== "done") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setTimeout(() => {
      router.push("/home");
      router.refresh();
    }, 2600);
    return () => clearTimeout(t);
  }, [stage, router]);

  if (stage) {
    return (
      <main className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-ink px-3 py-6">
        <Orbit facts={facts} found={found} stage={stage} noun={noun} target={target} error={failMessage}>
          {stage === "done" ? (
            <Link href="/home" className="button-primary h-12" onClick={() => router.refresh()}>
              See my verdict
            </Link>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              {reportId && (
                <button type="button" className="button-primary h-12" onClick={retry}>
                  Try again
                </button>
              )}
              <button
                type="button"
                className="button-ghost h-12"
                onClick={() => {
                  setStage(null);
                  setPicked([]);
                }}
              >
                Upload another file
              </button>
            </div>
          )}
        </Orbit>
        {stage !== "done" && stage !== "error" && (
          <Link href="/home" className="link-quiet mt-8 min-h-11 py-3 text-sm">
            Leave this screen. We&apos;ll keep reading.
          </Link>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:px-6 lg:pt-14">
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">Upload a blood report.</h1>
      <p className="mt-4 max-w-prose text-lg text-graphite">
        The PDF from your lab works best. Photos work too: flat, in good light, one page per photo, up to {MAX_FILES}.
      </p>
      {aiOff && (
        <p className="error-mark mt-6 border border-line-strong p-4 text-sm">
          Report reading isn&apos;t switched on yet on this server (no AI key). You can still upload; we&apos;ll keep your file.
        </p>
      )}

      <div
        className="mt-10 grid gap-3 sm:grid-cols-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        <button type="button" onClick={() => pdfInput.current?.click()} className="flex min-h-36 flex-col items-start justify-between border border-line-strong p-5 text-left active:bg-lift">
          <span className="text-2xl font-bold semiwide">PDF</span>
          <span className="text-sm text-graphite">From your lab&apos;s email or app. Up to 4 MB.</span>
        </button>
        <button type="button" onClick={() => photoInput.current?.click()} className="flex min-h-36 flex-col items-start justify-between border border-line-strong p-5 text-left active:bg-lift">
          <span className="text-2xl font-bold semiwide">Photos</span>
          <span className="text-sm text-graphite">Take or choose a photo of each page.</span>
        </button>
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => addFiles(e.target.files)} tabIndex={-1} aria-hidden />
        <input ref={photoInput} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} tabIndex={-1} aria-hidden />
      </div>

      {preparing && <p className="mt-4 text-sm text-graphite">Preparing your photos…</p>}

      {picked.length > 0 && (
        <section className="mt-8" aria-label="Chosen files">
          <ul className="flex flex-wrap gap-3">
            {picked.map((p, i) => (
              <li key={`${p.name}-${i}`} className="relative">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt={`Page ${i + 1}`} className="h-28 w-20 border border-line object-cover" />
                ) : (
                  <div className="flex h-28 w-48 flex-col justify-end border border-line p-3">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-graphite">{(p.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPicked((cur) => cur.filter((_, j) => j !== i))}
                  className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center bg-paper text-sm font-bold text-ink"
                  aria-label={`Remove ${p.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={start} disabled={preparing} className="button-primary mt-8 h-13 w-full sm:w-auto sm:px-10">
            Read my report
          </button>
        </section>
      )}

      {error && (
        <p role="alert" className="error-mark mt-6 text-sm">
          {error}
        </p>
      )}

      <p className="mt-12 max-w-prose text-sm text-graphite">
        Your file stays in your D-Human account, private to you. Claude, an AI model by Anthropic, reads it to build your read. You can delete it any time.
      </p>
    </main>
  );
}
