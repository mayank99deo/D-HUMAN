import { SPOKEN, type SpokenId } from "@/lib/domain/speech";
import { LanguageTabs } from "./LanguageTabs";
import { nativeStyle } from "./native";

// Slide 2, on white: Fuel, the calorie and protein tracker. One meal, said in five of the
// languages people can log in (lib/domain/speech.ts), comes back with the same
// numbers every time. The labels around it stay English, as the app's do.
// Marker names stay in English inside every language, as the app's language rule
// asks. Every number is illustrative and labelled so.

type MealIn = { id: SpokenId; lang?: string; said: string; title: string; tip: string };

const MEAL_IN: MealIn[] = [
  {
    id: "en",
    said: "2 rotis, dal, bhindi sabzi and a katori of curd",
    title: "Dal, roti, bhindi and curd",
    tip: "Your ferritin was low. Squeeze lemon on the dal: vitamin C helps you absorb its iron.",
  },
  {
    id: "hinglish",
    said: "Do roti, dal, bhindi ki sabzi aur ek katori dahi",
    title: "Dal, roti, bhindi aur dahi",
    tip: "Aapka ferritin low tha. Dal pe nimbu nichod lo: vitamin C se iron better absorb hota hai.",
  },
  {
    id: "hi",
    lang: "hi",
    said: "दो रोटी, दाल, भिंडी की सब्ज़ी और एक कटोरी दही",
    title: "दाल, रोटी, भिंडी और दही",
    tip: "आपका ferritin कम था। दाल पर नींबू निचोड़ें: विटामिन C से शरीर आयरन बेहतर सोखता है।",
  },
  {
    id: "ta",
    lang: "ta",
    said: "இரண்டு சப்பாத்தி, பருப்பு, வெண்டைக்காய் பொரியல், ஒரு கிண்ணம் தயிர்",
    title: "சப்பாத்தி, பருப்பு, வெண்டைக்காய், தயிர்",
    tip: "உங்கள் ferritin குறைவாக இருந்தது. பருப்பில் எலுமிச்சை பிழியுங்கள்: வைட்டமின் C இரும்புச்சத்தை உடல் உறிஞ்ச உதவும்.",
  },
  {
    id: "bn",
    lang: "bn",
    said: "দুটো রুটি, ডাল, ঢেঁড়সের তরকারি আর এক বাটি দই",
    title: "ডাল, রুটি, ঢেঁড়স আর দই",
    tip: "আপনার ferritin কম ছিল। ডালে লেবু চিপে নিন: ভিটামিন C শরীরকে আয়রন শোষণ করতে সাহায্য করে।",
  },
];
const MEAL = { kcal: 590, protein: 23 };

const labelOf = (id: SpokenId) => SPOKEN.find((s) => s.id === id)?.label ?? id;
const TABS = MEAL_IN.map((m) => ({ id: m.id, label: labelOf(m.id), lang: m.lang, style: nativeStyle(m.lang) }));
// The rest of the languages people can log in, named in their own scripts.
const MORE = SPOKEN.filter((s) => !MEAL_IN.some((m) => m.id === s.id));
const LANG_CODE: Partial<Record<SpokenId, string>> = { mr: "mr", te: "te", gu: "gu", kn: "kn", ml: "ml", pa: "pa", ur: "ur" };

// Each language is a layer in one grid cell; the active one shows (see LanguageTabs).
// Written out in full so Tailwind can see every class.
const SHOW = [
  "group-data-[active=0]/rot:visible group-data-[active=0]/rot:opacity-100",
  "group-data-[active=1]/rot:visible group-data-[active=1]/rot:opacity-100",
  "group-data-[active=2]/rot:visible group-data-[active=2]/rot:opacity-100",
  "group-data-[active=3]/rot:visible group-data-[active=3]/rot:opacity-100",
  "group-data-[active=4]/rot:visible group-data-[active=4]/rot:opacity-100",
];
const LAYER =
  "invisible col-start-1 row-start-1 opacity-0 transition-[opacity,visibility] duration-300 motion-reduce:transition-none";

function Rotating({ field, className }: { field: "said" | "title" | "tip"; className: string }) {
  return (
    <div className="grid">
      {MEAL_IN.map((m, i) => (
        <p key={m.id} lang={m.lang} style={nativeStyle(m.lang)} className={`${LAYER} ${SHOW[i]} ${className}`}>
          {m[field]}
        </p>
      ))}
    </div>
  );
}

const DETAILS = [
  { title: "Targets", body: "Set for your body and training. Vitamins and minerals per ICMR-NIN 2020." },
  { title: "Gaps", body: "What runs short over two weeks of meals." },
  { title: "Usual day", body: "Won't log every meal? Describe a normal day once." },
  { title: "Your report", body: "Add a blood report, and each tip follows its flags." },
];

export function Fuel() {
  return (
    <section
      id="fuel"
      aria-labelledby="fuel-title"
      className="paper flex min-h-[calc(100svh-5rem)] snap-start flex-col justify-center py-16 lg:py-12"
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-10">
        <div className="lg:col-span-5">
          <p className="text-sm font-semibold text-smoke">Calorie tracking</p>
          <h2 id="fuel-title" className="semiwide mt-3 max-w-[12ch] text-title font-bold">
            Snap it. Say it. Type it.
          </h2>
          <p className="mt-6 max-w-[40ch]">
            AI estimates your meal in Indian portions. Say or type it in any of {SPOKEN.length} languages, and the
            note comes back in yours.
          </p>
        </div>

        <figure className="lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:self-center">
          <LanguageTabs tabs={TABS} idBase="meal-lang" label="Language of the example meal" tone="paper">
            <div className="border border-ink bg-paper p-5 sm:p-6">
              <p className="text-sm text-smoke">What you said</p>
              <Rotating field="said" className="mt-1 text-lg leading-snug" />
              <div className="mt-5 border-t border-rule pt-5">
                <p className="text-sm text-smoke">Logged</p>
                <Rotating field="title" className="mt-1 text-xl font-bold leading-snug" />
                {/* The same numbers in every language: it's the same meal. */}
                <p className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <span className="whitespace-nowrap">
                    <span className="display-num text-4xl">{MEAL.kcal}</span> <span className="text-smoke">kcal</span>
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="display-num text-4xl">{MEAL.protein}</span> <span className="text-smoke">g protein</span>
                  </span>
                </p>
                <Rotating field="tip" className="mt-4 leading-normal" />
              </div>
            </div>
          </LanguageTabs>
          <figcaption className="mt-4 text-sm text-smoke">
            <span className="block">
              Also{" "}
              {MORE.map((s, i) => (
                <span key={s.id}>
                  <bdi lang={LANG_CODE[s.id]} style={nativeStyle(s.id)}>
                    {s.label}
                  </bdi>
                  {i < MORE.length - 1 ? ", " : "."}
                </span>
              ))}
            </span>
            <span className="mt-1 block">Illustrative. Meal numbers are estimates, not lab measurements.</span>
          </figcaption>
        </figure>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:gap-x-8 lg:col-span-5 lg:row-start-2 lg:self-start">
          {DETAILS.map((d) => (
            <div key={d.title} className="border-t border-rule pt-3">
              <dt className="font-semibold">{d.title}</dt>
              <dd className="mt-0.5 text-smoke">{d.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
