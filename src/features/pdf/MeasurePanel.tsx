// The measurements list (with totals and Copy as CSV) and the scale dialogs.
import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import { Sheet, useToast } from "@/components/ui";
import { fmt2, metresPerPoint, polyArea, polyLength } from "./geom";
import type { DocState, MeasureObj } from "./model";

const PRESETS = [20, 50, 100, 200, 500, 1000];

function valueOf(o: MeasureObj, mpp: number | undefined): { value: number | null; unit: string } {
  if (o.kind === "count") return { value: o.points.length, unit: "items" };
  if (!mpp) return { value: null, unit: o.kind === "length" ? "m" : "m²" };
  return o.kind === "length" ? { value: polyLength(o.points) * mpp, unit: "m" } : { value: polyArea(o.points) * mpp * mpp, unit: "m²" };
}

export function MeasurePanel({
  state,
  pageNumber,
  onPick,
  onClose,
}: {
  state: DocState;
  pageNumber: (slot: string) => number;
  onPick: (slot: string, id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const rows = state.slots.flatMap((s) =>
    (state.objects[s.id] ?? [])
      .filter((o): o is MeasureObj => o.type === "measure")
      .map((o) => ({ slot: s.id, o, page: pageNumber(s.id), ...valueOf(o, state.scales[s.id]) })),
  );
  const total = (kind: MeasureObj["kind"]) => rows.filter((r) => r.o.kind === kind && r.value !== null).reduce((n, r) => n + (r.value ?? 0), 0);
  const label = (k: MeasureObj["kind"]) => (k === "length" ? "Length" : k === "area" ? "Area" : "Count");

  async function copy() {
    const lines = ["Page,Type,Value,Unit", ...rows.map((r) => `${r.page},${label(r.o.kind)},${r.value === null ? "" : r.o.kind === "count" ? r.value : r.value.toFixed(2)},${r.unit}`)];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Measurements copied. Paste them into Excel.");
    } catch {
      toast("Copying isn't allowed here. Select the list and copy it instead.", "error");
    }
  }

  return (
    <aside className="pdf-side glass-strong" aria-label="Measurements">
      <div className="pdf-side-head">
        <b>Measurements</b>
        <button type="button" className="btn small" onClick={copy} disabled={!rows.length}>
          <Copy /> Copy as CSV
        </button>
        <button type="button" className="icon-btn small plain" onClick={onClose} aria-label="Close the list">
          <X />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted small" style={{ padding: "4px 14px 14px" }}>
          Nothing measured yet. Choose Length, Area or Count, then tap on the drawing.
        </p>
      ) : (
        <>
          <div className="pdf-side-list">
            {rows.map((r, i) => (
              <button key={r.o.id} type="button" className="pdf-side-row" onClick={() => onPick(r.slot, r.o.id)}>
                <span className="pdf-side-dot" style={{ background: r.o.color }} />
                <span className="grow">
                  {label(r.o.kind)} {i + 1}
                  <span className="muted tiny"> · page {r.page}</span>
                </span>
                <b>{r.value === null ? "Set scale" : r.o.kind === "count" ? r.value : `${fmt2(r.value)} ${r.unit}`}</b>
              </button>
            ))}
          </div>
          <div className="pdf-side-totals">
            {rows.some((r) => r.o.kind === "length") && (
              <span>
                Total length <b>{fmt2(total("length"))} m</b>
              </span>
            )}
            {rows.some((r) => r.o.kind === "area") && (
              <span>
                Total area <b>{fmt2(total("area"))} m²</b>
              </span>
            )}
            {rows.some((r) => r.o.kind === "count") && (
              <span>
                Total count <b>{total("count")}</b>
              </span>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

export function ScaleSheet({
  open,
  slot,
  current,
  suggest,
  onClose,
  onPick,
  onCalibrate,
}: {
  open: boolean;
  slot: string | null;
  current?: number;
  suggest?: () => Promise<number | null>;
  onClose: () => void;
  onPick: (mpp: number, all: boolean) => void;
  onCalibrate: () => void;
}) {
  const [denom, setDenom] = useState<number>(100);
  const [custom, setCustom] = useState("");
  const [found, setFound] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setFound(null);
    const d = current ? Math.round(current / metresPerPoint(1)) : null;
    setDenom(d && PRESETS.includes(d) ? d : 100);
    setCustom(d && !PRESETS.includes(d) ? String(d) : "");
    let alive = true;
    suggest?.().then((n) => {
      if (!alive || !n) return;
      setFound(n);
      if (!current) {
        if (PRESETS.includes(n)) setDenom(n);
        else setCustom(String(n));
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slot]);

  const n = custom ? Number(custom) : denom;
  const valid = Number.isFinite(n) && n > 0 && n <= 100000;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Drawing scale"
      footer={
        <>
          <button className="btn" type="button" onClick={() => valid && onPick(metresPerPoint(n), true)} disabled={!valid}>
            Use on every page
          </button>
          <button className="btn primary" type="button" onClick={() => valid && onPick(metresPerPoint(n), false)} disabled={!valid}>
            Use on this page
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <p className="muted small" style={{ margin: 0 }}>
          The scale the drawing was printed at on its paper size. Measurements are worked out from it.
        </p>
        {found && <div className="pdf-found small">This drawing says 1:{found}.</div>}
        <div className="pdf-presets">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`pdf-preset${!custom && denom === p ? " on" : ""}`}
              onClick={() => {
                setDenom(p);
                setCustom("");
              }}
            >
              1:{p}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Another scale, 1 to</span>
          <input className="input" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Another scale" />
        </label>
        <button type="button" className="btn ghost" onClick={onCalibrate}>
          Set it from a dimension I know instead
        </button>
      </div>
    </Sheet>
  );
}

export function CalibrateSheet({ open, lengthPt, onClose, onDone }: { open: boolean; lengthPt: number; onClose: () => void; onDone: (metres: number, all: boolean) => void }) {
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<"m" | "mm">("m");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  const n = Number(value);
  const metres = unit === "mm" ? n / 1000 : n;
  const ok = value !== "" && Number.isFinite(n) && n > 0 && lengthPt > 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="How long is that line?"
      footer={
        <>
          <button className="btn" type="button" onClick={() => ok && onDone(metres, true)} disabled={!ok}>
            Use on every page
          </button>
          <button className="btn primary" type="button" onClick={() => ok && onDone(metres, false)} disabled={!ok}>
            Use on this page
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Type the real length of the line you just drew, as written on the drawing.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 0 }} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Real length" autoFocus />
          <select className="input" style={{ width: 90 }} value={unit} onChange={(e) => setUnit(e.target.value as "m" | "mm")} aria-label="Unit">
            <option value="m">m</option>
            <option value="mm">mm</option>
          </select>
        </div>
        {ok && <span className="small muted">That makes the scale about 1:{Math.round(metres / lengthPt / metresPerPoint(1))}.</span>}
      </div>
    </Sheet>
  );
}
