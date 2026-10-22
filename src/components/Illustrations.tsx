// Small navy and red line drawings for empty screens. Colours come from CSS (polish.css),
// so they follow light and dark mode.
import { isValidElement, type ReactNode } from "react";

export type ArtName =
  | "done"
  | "tasks"
  | "calendar"
  | "inbox"
  | "search"
  | "announce"
  | "files"
  | "chat"
  | "boq"
  | "history"
  | "map"
  | "lock"
  | "projects";

const ART: Record<ArtName, ReactNode> = {
  done: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <rect className="pp" x="50" y="22" width="60" height="76" rx="9" />
      <rect className="pp" x="66" y="15" width="28" height="13" rx="5" />
      <path className="ln" d="M62 48l4.5 4.5 8.5-9" />
      <path className="ln2" d="M82 48h18" />
      <path className="ln" d="M62 66l4.5 4.5 8.5-9" />
      <path className="ln2" d="M82 66h18" />
      <path className="ln2" d="M62 84h38" />
      <circle className="rd" cx="113" cy="90" r="14" />
      <path className="wt" d="M106.5 90l4.5 4.5 8.5-9" />
    </>
  ),
  tasks: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <rect className="pp" x="46" y="22" width="60" height="78" rx="9" />
      <rect className="pp" x="62" y="15" width="28" height="13" rx="5" />
      <rect className="ln" x="58" y="42" width="9" height="9" rx="2" />
      <path className="ln2" d="M74 46.5h22" />
      <rect className="ln" x="58" y="60" width="9" height="9" rx="2" />
      <path className="ln2" d="M74 64.5h22" />
      <rect className="ln" x="58" y="78" width="9" height="9" rx="2" />
      <path className="ln2" d="M74 82.5h14" />
      <path className="ln" d="M114 62v40" />
      <path className="rd" d="M114 62h22l-6 8 6 8h-22z" />
    </>
  ),
  calendar: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <rect className="pp" x="38" y="28" width="84" height="72" rx="10" />
      <path className="nv" d="M38 38a10 10 0 0 1 10-10h64a10 10 0 0 1 10 10v8H38z" />
      <path className="ln" d="M58 21v13M102 21v13" />
      {[56, 72, 88, 104].map((x) => [60, 74, 88].map((y) => (x === 88 && y === 74 ? null : <circle key={`${x}-${y}`} className="dt" cx={x} cy={y} r="3.2" />)))}
      <circle className="rd" cx="88" cy="74" r="7" />
    </>
  ),
  inbox: (
    <>
      <ellipse className="bg" cx="80" cy="66" rx="64" ry="44" />
      <rect className="pp" x="61" y="22" width="38" height="28" rx="4" />
      <path className="ln" d="M61 27l19 12 19-12" />
      <path className="pp" d="M40 72l15-30h50l15 30v18a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8z" />
      <path className="ln" d="M40 72h25l5 9h20l5-9h25" />
      <circle className="rd" cx="116" cy="38" r="7" />
    </>
  ),
  search: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <rect className="pp" x="40" y="22" width="54" height="70" rx="8" />
      <path className="ln2" d="M52 40h30M52 52h30M52 64h18" />
      <circle className="pp" cx="98" cy="72" r="21" />
      <path className="ln" d="M113 87l14 14" style={{ strokeWidth: 5 }} />
      <path className="rdl" d="M91 65l14 14M105 65L91 79" />
    </>
  ),
  announce: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <path className="pp" d="M42 56v20a5 5 0 0 0 5 5h12l30 17V34L59 51H47a5 5 0 0 0-5 5z" />
      <path className="ln" d="M60 81l6 17h11l-4-15" />
      <path className="rdl" d="M100 54c6 5 6 19 0 24" />
      <path className="ln" d="M109 45c11 9 11 33 0 42" />
      <path className="ln2" d="M118 37c15 12 15 46 0 58" />
    </>
  ),
  files: (
    <>
      <ellipse className="bg" cx="80" cy="66" rx="64" ry="44" />
      <rect className="pp" x="62" y="20" width="54" height="70" rx="7" transform="rotate(9 89 55)" />
      <rect className="pp" x="44" y="28" width="56" height="72" rx="7" />
      <path className="ln2" d="M55 44h34v34H55zM72 44v17H55M72 61h17" />
      <path className="ln2" d="M55 88h22" />
      <path className="rdl" d="M92 18v28a7 7 0 0 1-14 0V26a4 4 0 0 1 8 0v18" />
    </>
  ),
  chat: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <path className="pp" d="M36 38a10 10 0 0 1 10-10h54a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H64L50 86V74h-4a10 10 0 0 1-10-10z" />
      <path className="ln2" d="M50 44h44M50 57h28" />
      <path className="rd" d="M86 72a8 8 0 0 1 8-8h26a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8h-2v10l-11-10H94a8 8 0 0 1-8-8z" />
      <circle className="wf" cx="99" cy="79" r="2.4" />
      <circle className="wf" cx="107" cy="79" r="2.4" />
      <circle className="wf" cx="115" cy="79" r="2.4" />
    </>
  ),
  boq: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <rect className="pp" x="34" y="22" width="68" height="80" rx="8" />
      <path className="nv" d="M34 30a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v8H34z" />
      <path className="ln2" d="M34 52h68M34 66h68M34 80h68M56 38v64M78 38v64" />
      <rect className="pp" x="92" y="56" width="36" height="46" rx="6" />
      <rect className="rd" x="98" y="62" width="24" height="10" rx="2" />
      {[101, 110, 119].map((x) => [82, 92].map((y) => <circle key={`${x}-${y}`} className="dt" cx={x} cy={y} r="2.6" />))}
    </>
  ),
  history: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <circle className="pp" cx="82" cy="62" r="34" />
      <path className="ln" d="M82 42v21l13 8" />
      <circle className="dt" cx="82" cy="33" r="2.6" />
      <circle className="dt" cx="111" cy="62" r="2.6" />
      <circle className="dt" cx="82" cy="91" r="2.6" />
      <circle className="dt" cx="53" cy="62" r="2.6" />
      <path className="rdl" d="M40 52a44 44 0 0 1 12-20" />
      <path className="rdl" d="M37 40l3 12 11-4" />
    </>
  ),
  map: (
    <>
      <ellipse className="bg" cx="80" cy="66" rx="64" ry="44" />
      <path className="pp" d="M34 40l30-10 32 10 30-10v62l-30 10-32-10-30 10z" />
      <path className="ln2" d="M64 30v62M96 40v62" />
      <path className="ln2" d="M44 82c10-14 24-4 34-16s20-8 28-18" style={{ strokeDasharray: "4 6" }} />
      <path className="rd" d="M108 22a13 13 0 0 1 13 13c0 10-13 24-13 24S95 45 95 35a13 13 0 0 1 13-13z" />
      <circle className="wf" cx="108" cy="35" r="5" />
    </>
  ),
  lock: (
    <>
      <ellipse className="bg" cx="80" cy="64" rx="64" ry="46" />
      <path className="ln" d="M64 54V44a16 16 0 0 1 32 0v10" style={{ strokeWidth: 4 }} />
      <rect className="pp" x="52" y="54" width="56" height="44" rx="9" />
      <circle className="rd" cx="80" cy="72" r="5.5" />
      <path className="rdl" d="M80 77v9" />
    </>
  ),
  projects: (
    <>
      <ellipse className="bg" cx="80" cy="66" rx="64" ry="44" />
      <path className="ln" d="M44 100h76" />
      <rect className="pp" x="56" y="44" width="28" height="56" rx="3" />
      <rect className="pp" x="88" y="62" width="22" height="38" rx="3" />
      {[52, 62, 72, 82].map((y) => (
        <path key={y} className="ln2" d={`M63 ${y}h6M73 ${y}h6`} />
      ))}
      <path className="ln" d="M40 100V24M40 28h62M40 40l12-12M92 28v16" />
      <path className="rdl" d="M88 44h8v6h-8z" />
      <path className="ln2" d="M95 72h8M95 82h8" />
    </>
  ),
};

/** Which drawing to show for each icon already used on empty screens. */
const BY_ICON: Record<string, ArtName> = {
  CircleCheck: "done",
  CircleCheckBig: "done",
  SquareCheckBig: "tasks",
  ListChecks: "tasks",
  CalendarDays: "calendar",
  CalendarClock: "calendar",
  Repeat: "calendar",
  Inbox: "inbox",
  SearchX: "search",
  Search: "search",
  Megaphone: "announce",
  Paperclip: "files",
  FileText: "files",
  MessageCircle: "chat",
  MessagesSquare: "chat",
  Layers: "boq",
  FileDiff: "boq",
  ClipboardList: "boq",
  History: "history",
  RotateCcwClock: "history",
  MapPin: "map",
  Lock: "lock",
  FolderKanban: "projects",
  Building2: "projects",
};

export function artForIcon(icon: ReactNode): ArtName | null {
  if (!isValidElement(icon)) return null;
  const type = icon.type as { displayName?: string; name?: string };
  const key = type.displayName ?? type.name ?? "";
  return BY_ICON[key] ?? null;
}

export function Illustration({ name }: { name: ArtName }) {
  return (
    <svg className="illo" viewBox="0 0 160 120" aria-hidden focusable="false">
      {ART[name]}
    </svg>
  );
}
