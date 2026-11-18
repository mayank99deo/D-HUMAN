// Blog fixtures: a valid post with one of every block, and list rows built from it.
import type { Block, LiveImage, PostDraft, PostLive, PostSummary, PublicAuthor } from "../../lib/blog/types.ts";

export function image(id: string, over: Partial<LiveImage> = {}): LiveImage {
  return {
    id,
    width: 1600,
    height: 1067,
    focalX: 0.5,
    focalY: 0.4,
    keepColour: false,
    files: [
      { name: "w480-a1b2c3.webp", width: 480, mime: "image/webp" },
      { name: "w960-d4e5f6.webp", width: 960, mime: "image/webp" },
      { name: "w1600-a7b8c9.webp", width: 1600, mime: "image/webp" },
    ],
    ...over,
  };
}

export const AUTHOR: PublicAuthor = {
  id: "author-1",
  slug: "mayank-narayan",
  name: "Mayank Narayan",
  role: "Co-founder, D-Human",
  bio: "Builds D-Human's app.",
  photo: null,
  links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/example" }],
};

export const BLOCKS: Block[] = [
  { id: "b1", type: "heading", level: 2, text: "Start from your weight" },
  {
    id: "b2",
    type: "paragraph",
    spans: [
      { text: "ICMR-NIN sets the adult amount per kilo. " },
      { text: "Read the guide", href: "/protein-tracker" },
      { text: " or the ", italic: true },
      { text: "source", bold: true, href: "https://www.nin.res.in/rdabook/brief_note.pdf" },
      { text: "." },
    ],
  },
  { id: "b3", type: "keyNumber", value: "0.83 g", label: "of protein per kilo of body weight a day", sourceId: "s1" },
  { id: "b4", type: "note", title: "Work it out", spans: [{ text: "Multiply your weight in kilos by 0.83." }] },
  { id: "b5", type: "heading", level: 2, text: "If you train" },
  { id: "b6", type: "quote", text: "Start from your weight, not from a tub." },
  { id: "b7", type: "table", caption: "Protein a day", header: ["Weight", "Baseline"], rows: [["50 kg", "42 g"], ["60 kg", "50 g"]], sourceId: "s1" },
  { id: "b8", type: "photo", imageId: "img-thali", alt: "A steel thali with rice, rotis and dal", caption: "A home thali.", credit: "Photo: the author." },
  { id: "b9", type: "tryIt", destination: "fuel", line: "" },
  { id: "b10", type: "list", ordered: false, items: [[{ text: "Log a normal day first." }], [{ text: "Add to the light meal." }]] },
  { id: "b11", type: "heading", level: 2, text: "When to check first" },
  { id: "b12", type: "doctor", spans: [{ text: "If you have a kidney condition, ask your doctor first." }] },
  { id: "b13", type: "tryIt", destination: "guide", guidePath: "/protein-tracker", line: "" },
];

export function draft(over: Partial<PostDraft> = {}): PostDraft {
  return {
    title: "How much protein do you need if you train?",
    dek: "Start from your weight, then add for training.",
    cover: { imageId: "img-cover", alt: "Grilled paneer in front of three bowls" },
    blocks: structuredClone(BLOCKS),
    sources: [{ id: "s1", name: "ICMR-NIN, Nutrient Requirements for Indians, 2020.", url: "https://www.nin.res.in/rdabook/brief_note.pdf" }],
    seoDescription: "How much protein you need a day, from your weight and training.",
    ...over,
  };
}

export function live(over: Partial<PostLive> = {}): PostLive {
  return {
    ...draft(),
    topic: "protein",
    language: "en",
    readingMinutes: 3,
    author: AUTHOR,
    images: { "img-cover": image("img-cover"), "img-thali": image("img-thali") },
    share: null,
    ...over,
  };
}

let n = 0;
/** A list row; dates default to a fixed day, so tests are stable. */
export function summary(over: Partial<PostSummary> = {}): PostSummary {
  n += 1;
  return {
    id: `post-${n}`,
    slug: `post-number-${n}`,
    title: `Post number ${n}`,
    dek: "A short standfirst.",
    seoDescription: "",
    topic: "calories",
    language: "en",
    cover: null,
    author: AUTHOR,
    publishedAt: "2026-11-10T03:30:00.000Z",
    updatedOn: null,
    readingMinutes: 4,
    featured: false,
    share: null,
    ...over,
  };
}
