// The look of the weekly update report, on screen, printed and as a PDF: Salam's branding, with a
// line saying Northcroft's QS team prepared it. The colours come from Salam's logo.
//
// Until the logo is in public/brand, the report shows Salam's name in the heading font instead, and
// these colours stand in.
export const REPORT_BRAND = {
  /** Shown at the top when there's no logo, and in the file name. */
  name: "Salam",
  /** The logo at the top of the report (PNG, JPG or SVG in public/brand), or null. */
  logo: null as string | null,
  /** Headings, the band at the top and the bars. */
  primary: "#0B1F35",
  /** The rule under the heading and small highlights. */
  accent: "#B08D57",
  /** Light fill behind the figures and section headings. */
  tint: "#F3EEE3",
  /** Text on white. */
  ink: "#1B1B1F",
  /** Quieter text: dates, labels. */
  muted: "#4A4F5C",
  preparedBy: "Prepared by Northcroft QS team",
  /** Fonts bundled in public/fonts/report (also embedded in the PDF). */
  headingFont: "Marcellus",
  bodyFont: "Open Sans",
};

export const REPORT_FONTS = {
  heading: "/fonts/report/Marcellus-Regular.ttf",
  regular: "/fonts/report/OpenSans-Regular.ttf",
  semibold: "/fonts/report/OpenSans-SemiBold.ttf",
  bold: "/fonts/report/OpenSans-Bold.ttf",
  italic: "/fonts/report/OpenSans-Italic.ttf",
};
