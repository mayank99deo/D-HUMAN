"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import type { AskReadLanguage, AskRegion } from "@/lib/ask/types";
import { ASK_OPEN_EVENT, askPhase, keyIsForPage, loadAskSheet, openAsk, preloadAsk, type OpenRequest } from "./ask-open";
import type { SheetProps } from "./AskSheet";

/** Fetch the sheet's code this long after the page loads, when the browser is idle. */
const IDLE_PRELOAD_MS = 5_000;

/**
 * Mounted once in the app layout for people Ask is open to. It listens for requests to
 * open Ask, loads the sheet's code the first time, and keeps the sheet mounted from then
 * on, so an answer that lands while it's shut is there on reopening.
 */
export function AskHost({ who, region, readLanguage }: { who: string; region: AskRegion; readLanguage: AskReadLanguage }) {
  const [Sheet, setSheet] = useState<ComponentType<SheetProps> | null>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const phase = useSyncExternalStore(askPhase.subscribe, askPhase.get, askPhase.server);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const req = (e as CustomEvent<OpenRequest>).detail;
      if (askPhase.get() === "closed") askPhase.set("loading");
      loadAskSheet().then(
        (mod) => {
          setSheet(() => mod.AskSheet);
          setRequest(req);
          askPhase.set("open");
        },
        () => askPhase.set("closed"),
      );
    };
    window.addEventListener(ASK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASK_OPEN_EVENT, onOpen);
  }, []);

  // At idle, a few seconds after load, so the first tap opens at once.
  useEffect(() => {
    let idle = 0;
    const t = window.setTimeout(() => {
      idle = window.requestIdleCallback ? window.requestIdleCallback(preloadAsk) : window.setTimeout(preloadAsk, 0);
    }, IDLE_PRELOAD_MS);
    return () => {
      window.clearTimeout(t);
      if (idle && window.cancelIdleCallback) window.cancelIdleCallback(idle);
    };
  }, []);

  // "/" opens Ask on a keyboard, unless they're typing or another dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return;
      if (!keyIsForPage(e.target)) return;
      e.preventDefault();
      openAsk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!Sheet) return null;
  return <Sheet open={phase === "open"} request={request} onClose={() => askPhase.set("closed")} who={who} region={region} readLanguage={readLanguage} />;
}
