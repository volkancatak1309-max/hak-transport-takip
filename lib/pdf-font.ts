"use client";

import { Font } from "@react-pdf/renderer";

/**
 * PDF font family. We embed Geist (the app's brand font, SIL OFL) which has full
 * Turkish (ş ğ ı İ ç ö ü) AND German (ä ö ü ß) glyph coverage — the built-in
 * Helvetica does not, so those characters rendered broken before.
 *
 * Only a regular weight TTF is bundled, so "bold" maps to the same file (text
 * stays correct; it simply isn't visually heavier).
 */
export const PDF_FONT = "Geist";

let registered = false;

export function registerPdfFont() {
  if (registered) return;
  registered = true;
  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: "/fonts/Geist-Regular.ttf", fontWeight: 400 },
      { src: "/fonts/Geist-Regular.ttf", fontWeight: 700 },
    ],
  });
  // Don't let the layout engine hyphenate/break words in odd places.
  Font.registerHyphenationCallback((word) => [word]);
}
