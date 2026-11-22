// A meal photo from the camera or the gallery (components/platform/meal-photo.ts): why a
// picked file couldn't be opened, the words on Fuel's photo controls, and the tour's Fuel stop.
//
// Mayank (2026-11-22, iPhone 17): "for the snap thing let's add the option to choose from the
// gallery as well." Snap keeps its one tap to the camera; the gallery sits one tap from the
// tiles on phones; laptops pick a file, and their labels say so.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { PHOTO_ACCEPT, PHOTO_COPY, MEAL_PHOTO_EDGE, photoProblem } = await import("../components/platform/meal-photo.ts");
const { TOUR } = await import("../components/platform/tour-stops.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
// An ISO box: size, "ftyp", then the brand.
const ftyp = (brand: string) => bytes([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0]);

describe("why a photo couldn't be opened", () => {
  it("spots HEIC by its bytes, even with no name or label", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1", "msf1"]) {
      assert.equal(photoProblem({ name: "", type: "" }, ftyp(brand)), "heic", brand);
    }
  });

  it("spots HEIC by its label or name when the bytes didn't arrive", () => {
    assert.equal(photoProblem({ name: "IMG_0412.jpg", type: "image/heic" }, new Uint8Array()), "heic");
    assert.equal(photoProblem({ name: "IMG_0412.HEIC", type: "" }, new Uint8Array()), "heic");
    assert.equal(photoProblem({ name: "x.heif", type: "image/heif-sequence" }, new Uint8Array()), "heic");
  });

  it("doesn't call AVIF HEIC (it shares the box)", () => {
    assert.equal(photoProblem({ name: "a.avif", type: "image/avif" }, ftyp("avif")), "unreadable");
  });

  it("says a file that isn't a photo isn't one", () => {
    assert.equal(photoProblem({ name: "report.pdf", type: "application/pdf" }, bytes("%PDF-1.7")), "not_image");
    assert.equal(photoProblem({ name: "notes.txt", type: "text/plain" }, bytes("2 rotis and dal")), "not_image");
    assert.equal(photoProblem({ name: "clip.mov", type: "video/quicktime" }, ftyp("qt  ")), "unreadable", "an ISO box we can't name: no claim it isn't a photo");
  });

  it("calls a real photo that wouldn't decode unreadable, not the wrong format", () => {
    assert.equal(photoProblem({ name: "thali.jpg", type: "image/jpeg" }, bytes([0xff, 0xd8, 0xff, 0xe0])), "unreadable");
    assert.equal(photoProblem({ name: "s.png", type: "image/png" }, bytes([0x89, 0x50, 0x4e, 0x47])), "unreadable");
    assert.equal(photoProblem({ name: "w.webp", type: "" }, bytes("RIFF", [0, 0, 0, 0], "WEBP")), "unreadable");
    assert.equal(photoProblem({ name: "odd", type: "image/x-unknown" }, new Uint8Array()), "unreadable");
  });
});

describe("the photo controls' words", () => {
  it("has a message for every problem, each saying what to do next", () => {
    for (const [k, v] of Object.entries(PHOTO_COPY.problems)) {
      assert.ok(v.length < 140, `${k} is short`);
      assert.match(v, /\b(Choose|Try|Log|save)\b/, `${k} gives a way on`);
      assert.doesNotMatch(v, /^!/, `${k}: the "!" comes from .error-mark`);
    }
    assert.match(PHOTO_COPY.problems.heic, /HEIC/);
  });

  it("keeps Snap for the camera and says Photo where there is none", () => {
    assert.equal(PHOTO_COPY.snap.title, "Snap");
    assert.doesNotMatch(PHOTO_COPY.file.title + PHOTO_COPY.file.note, /snap|gallery|camera/i, "true on a laptop");
    assert.match(PHOTO_COPY.gallery, /gallery/);
  });

  it("asks only for image/*, so iPhone converts HEIC to JPEG", () => {
    assert.equal(PHOTO_ACCEPT, "image/*");
    assert.equal(MEAL_PHOTO_EDGE, 1280);
  });

  it("wires Fuel as designed: a camera input, a gallery input, labels by pointer", () => {
    const fuel = readFileSync(path.join(root, "components/platform/FuelLogger.tsx"), "utf8");
    assert.match(fuel, /ref=\{camera\}[^>]*capture="environment"/, "Snap's input captures");
    const galleryInput = fuel.match(/<input ref=\{gallery\}[^>]*>/)?.[0] ?? "";
    assert.ok(galleryInput, "a second input for the gallery");
    assert.doesNotMatch(galleryInput, /capture/, "the gallery input never captures");
    // The tile opens the camera only where the labels say Snap: the same media query.
    assert.match(fuel, /matchMedia\("\(pointer: coarse\)"\)/);
    assert.match(readFileSync(path.join(root, "app/globals.css"), "utf8"), /@custom-variant touch \(@media \(pointer: coarse\)\)/);
    // Each pick clears its input, so the same photo can be picked twice in a row.
    assert.match(fuel, /e\.currentTarget\.value = ""/);
  });
});

describe("the tour's Fuel stop", () => {
  const fuel = TOUR.find((s) => s.id === "fuel")!;
  it("mentions the gallery on phones and stays true on laptops", () => {
    assert.match(fuel.touch ?? "", /Snap/);
    assert.match(fuel.touch ?? "", /gallery/);
    assert.doesNotMatch(fuel.body, /snap|gallery|camera/i);
    assert.match(fuel.body, /photo/);
  });
});
