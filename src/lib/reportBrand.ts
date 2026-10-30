// The look of the weekly update report, on screen, printed and as a PDF: Northcroft's colours and
// fonts (the app's own), with the Northcroft and Salam logos side by side at the top.
export const REPORT_BRAND = {
  /** In the file name. */
  name: "Northcroft",
  /** Salam's logo next to Northcroft's: the symbol, and the Arabic and English name beside it
   *  (cut from the Salam logo, clear background, in public/brand). */
  salamMark: "/brand/salam-mark.png",
  salamWords: "/brand/salam-words.png",
  salamName: "Salam Enterprises Ltd",
  /** Northcroft navy: the band at the top, headings and the bars. */
  primary: "#012061",
  /** Northcroft red: the rule under the band and small highlights. */
  accent: "#F13E44",
  /** Light navy behind the figures and notes. */
  tint: "#EEF2F9",
  /** Text on white. */
  ink: "#14171F",
  /** Quieter text: dates, labels. */
  muted: "#4A5570",
  preparedBy: "Prepared by Northcroft QS team",
};

/** Fonts bundled in public/fonts/report, also put inside the PDF. */
export const REPORT_FONTS = {
  headingSemi: "/fonts/report/SairaSemiCondensed-SemiBold.ttf",
  heading: "/fonts/report/SairaSemiCondensed-Bold.ttf",
  regular: "/fonts/report/Inter-Regular.ttf",
  semibold: "/fonts/report/Inter-SemiBold.ttf",
  bold: "/fonts/report/Inter-Bold.ttf",
};
