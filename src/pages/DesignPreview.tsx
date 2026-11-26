// Design gallery: every part of the new Apple-style look on one page, filled with made-up sample
// data, so it can be judged on a phone (light, dark, glass strength, text size) without touching
// real work. Managers only; nothing here reads or writes the database.
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Archive, FolderKanban, Link2, MailOpen, Plus, Share, Sparkles, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Sheet } from "@/components/Sheet";
import { openContextMenu } from "@/components/ContextMenu";
import { Pill, SearchField, Segmented, StatusRing, Switch, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { readPreviewLook, savePreviewLook } from "@/lib/appearance";
import "@/styles/appearance.css";

const SWATCHES = [
  ["Blue", "var(--accent)"],
  ["Green", "var(--green-fill, #34c759)"],
  ["Orange", "var(--orange-fill, #ff9500)"],
  ["Red", "var(--red-fill, #ff3b30)"],
  ["Purple", "#af52de"],
  ["Teal", "#30b0c7"],
  ["Indigo", "#5856d6"],
  ["Pink", "#ff2d55"],
];

const SAMPLE_TASKS = [
  { title: "Measure level 3 drywall partitions", project: "King Salman Park Pavilion", colour: "#FF9500", due: "Today", late: false, status: "in_progress" as const },
  { title: "Price VO-14 lighting changes", project: "Diriyah Gate Hotel", colour: "#5856D6", due: "Tue, 24 Nov", late: true, status: "todo" as const },
  { title: "Check interim payment 7", project: "Red Sea Villas", colour: "#30B0C7", due: "Tomorrow", late: false, status: "in_review" as const },
];

export default function DesignPreview() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [seg, setSeg] = useState<"one" | "two" | "three">("one");
  const [on, setOn] = useState(true);
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(false);
  const [look, setLook] = useState(readPreviewLook);
  if (!isManager) return <Navigate to="/" replace />;

  return (
    <div className="page design-preview">
      <PageHead title="Design gallery" sub="The new look with made-up sample data. Only managers see this page." />

      <div className="group-title">Try a new look</div>
      <div className="group">
        <div className="dp-pad row" style={{ justifyContent: "space-between", gap: 12 }}>
          <span>
            Thick glass
            <small className="dp-note">Bars, menus and sheets get a bevelled glass rim, like an iPhone folder.</small>
          </span>
          <Switch checked={look.thick} onChange={(v) => setLook(savePreviewLook({ thick: v }))} label="Thick glass" />
        </div>
        <div className="dp-pad row" style={{ justifyContent: "space-between", gap: 12, borderTop: "0.5px solid var(--separator)" }}>
          <span>
            Colour background
            <small className="dp-note">A soft wash of colour behind the page, so the glass shows its depth.</small>
          </span>
          <Switch checked={look.wash} onChange={(v) => setLook(savePreviewLook({ wash: v }))} label="Colour background" />
        </div>
      </div>
      <div className="group-foot">Only on this device, across the whole app, until you switch them off here.</div>

      <div className="group-title">Colours</div>
      <div className="group dp-pad">
        <div className="dp-swatches">
          {SWATCHES.map(([name, c]) => (
            <span key={name} className="dp-swatch">
              <i style={{ background: c }} />
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="group-title">Type</div>
      <div className="group dp-pad dp-type">
        <div style={{ fontSize: "var(--t-large)", fontWeight: 700, letterSpacing: "-0.02em" }}>Large title</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Title</div>
        <div style={{ fontSize: "var(--t-headline)", fontWeight: 600 }}>Headline</div>
        <div style={{ fontSize: "var(--t-body)" }}>Body text, the size most of the app is written in.</div>
        <div style={{ fontSize: "var(--t-foot)", color: "var(--text-2)" }}>Footnote in the secondary colour</div>
      </div>

      <div className="group-title">Buttons and controls</div>
      <div className="group dp-pad dp-stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary" type="button">
            <Plus /> New task
          </button>
          <button className="btn" type="button">
            Secondary
          </button>
          <button className="btn glassy" type="button">
            <Sparkles /> Glass
          </button>
          <button className="btn danger" type="button">
            <Trash2 /> Delete
          </button>
        </div>
        <Segmented
          value={seg}
          onChange={setSeg}
          options={[
            { value: "one", label: "Mine", count: 4 },
            { value: "two", label: "To review" },
            { value: "three", label: "Everyone", count: 9 },
          ]}
        />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span>A switch</span>
          <Switch checked={on} onChange={setOn} label="Sample switch" />
        </div>
        <SearchField value={q} onChange={setQ} placeholder="Search" />
        <div className="row wrap" style={{ gap: 6 }}>
          <Pill tone="blue">In progress</Pill>
          <Pill tone="green">Approved</Pill>
          <Pill tone="orange">On hold</Pill>
          <Pill tone="red">Urgent</Pill>
          <Pill tone="purple">With Priya</Pill>
        </div>
      </div>

      <div className="group-title">A list (press and hold a row)</div>
      <div className="group">
        {SAMPLE_TASKS.map((t) => (
          <div
            key={t.title}
            className="task-row"
            role="button"
            tabIndex={0}
            onContextMenu={(e) => {
              e.preventDefault();
              openSampleMenu(e.currentTarget, t.title);
            }}
            onClick={(e) => openSampleMenu(e.currentTarget, t.title)}
          >
            <StatusRing status={t.status} />
            <div className="body">
              <div className="t">{t.title}</div>
              <div className="m">
                <span className="row" style={{ gap: 5 }}>
                  <i style={{ width: 8, height: 8, borderRadius: 4, background: t.colour, display: "inline-block" }} />
                  {t.project}
                </span>
                <span style={{ color: t.late ? "var(--red-fill)" : undefined }}>{t.due}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="group-title">Messages</div>
      <div className="group dp-pad">
        <div className="thread">
          <div className="msg">
            <div className="bubble">
              Hi Alex, the canopy steelwork BOQ is ready for a first look.
              <div className="when">9:41</div>
            </div>
          </div>
          <div className="msg mine">
            <div className="bubble">
              Great, I'll check it after lunch.
              <div className="when">9:42</div>
            </div>
          </div>
        </div>
      </div>

      <div className="group-title">Liquid Glass</div>
      <div className="group">
        <div className="ap-glass-preview" style={{ height: 150 }}>
          <span className="ap-glass-art" />
          <span className="ap-glass-bar lg">
            <span className="on" />
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="dp-pad row wrap" style={{ gap: 8 }}>
          <button className="btn" type="button" onClick={() => setSheet(true)}>
            Open a sheet
          </button>
          <button className="btn" type="button" onClick={() => toast("Saved. This is what a message looks like.")}>
            Show a toast
          </button>
          <button className="btn" type="button" onClick={(e) => openSampleMenu(e.currentTarget, "Sample menu")}>
            Open a menu
          </button>
        </div>
      </div>

      <div className="group-title">Catch up</div>
      <div className="group dp-pad catchup">
        <p className="cu-headline">Sara sent the canopy BOQ and is waiting for your comments before Thursday.</p>
        <div className="group cu-for-you">
          <div className="cu-label">For you</div>
          <ul>
            <li>Check the canopy quantities in BOQ rev C</li>
          </ul>
        </div>
        <ul className="cu-points">
          <li>Sara used drawing rev C, with connections at 8% for now.</li>
          <li>Priya updated the cost report template this morning.</li>
        </ul>
      </div>
      <div className="group-foot">Sample text. In the app it's written by Claude from the real messages.</div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="A sheet"
        footer={
          <button className="btn primary" type="button" onClick={() => setSheet(false)}>
            Done
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>Sheets rise from the bottom on a phone, inset from the edges, and can be dragged down to close.</p>
        <SearchField value="" onChange={() => undefined} placeholder="Search people" />
      </Sheet>
    </div>
  );

  function openSampleMenu(el: HTMLElement, title: string) {
    openContextMenu(
      el,
      [
        { label: "Open", icon: <SquareArrowOutUpRight />, run: () => toast("Opened (sample)") },
        { label: "Mark as read", icon: <MailOpen />, run: () => toast("Marked as read (sample)") },
        { label: "Open the project", icon: <FolderKanban />, run: () => toast("Sample only") },
        null,
        { label: "Copy link", icon: <Link2 />, run: () => toast("Copied (sample)") },
        { label: "Share", icon: <Share />, run: () => toast("Sample only") },
        null,
        { label: "Archive", icon: <Archive />, run: () => toast("Archived (sample)"), danger: true },
      ],
      title,
    );
  }
}
