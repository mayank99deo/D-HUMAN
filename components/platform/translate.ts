// Meal words into English with the browser's own on-device translator (Chrome 138+
// on desktop; not on phones yet). Used only when the language pack is already on
// the device, so we never start a download, and never for long: anything else (no
// API, no pack, too slow, an error) gives null and the words go as they are.
// Claude reads Indian languages too, so a missing translation costs nothing.
// API shape: the Translator WebIDL in webmachinelearning.github.io/translation-api.

type Availability = "unavailable" | "downloadable" | "downloading" | "available";
type Pair = { sourceLanguage: string; targetLanguage: string };
type BrowserTranslator = {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
};
type TranslatorApi = {
  availability(options: Pair): Promise<Availability>;
  create(options: Pair & { signal?: AbortSignal }): Promise<BrowserTranslator>;
};

function translatorApi(): TranslatorApi | null {
  const api = (globalThis as { Translator?: Partial<TranslatorApi> }).Translator;
  return api && typeof api.availability === "function" && typeof api.create === "function" ? (api as TranslatorApi) : null;
}

/** `from` is a language tag such as "ta"; null means there's nothing to translate. */
export async function toEnglish(text: string, from: string | null, { timeoutMs = 2500, maxLength = Infinity } = {}): Promise<string | null> {
  const words = text.trim();
  const api = from && words ? translatorApi() : null;
  if (!api || !from) return null;

  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // availability() takes no signal, and a browser may ignore one, so every step races the clock.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("translation timed out"));
    }, timeoutMs);
  });
  const inTime = <T,>(step: Promise<T>) => Promise.race([step, deadline]);

  let translator: BrowserTranslator | null = null;
  try {
    const pair = { sourceLanguage: from, targetLanguage: "en" };
    if ((await inTime(api.availability(pair))) !== "available") return null;
    const creating = api.create({ ...pair, signal: abort.signal });
    // One that arrives after we gave up is released straight away.
    creating.then((late) => abort.signal.aborted && late.destroy?.(), () => {});
    translator = await inTime(creating);
    const english = (await inTime(translator.translate(words, { signal: abort.signal }))).trim();
    return english && english !== words && english.length <= maxLength ? english : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    translator?.destroy?.();
  }
}
