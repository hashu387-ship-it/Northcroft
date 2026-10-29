// One weekly update report, in Salam's branding: the Thursday week, the last 7 days, or days someone
// picked. Print it, download it as a PDF, or send it from the phone's share menu. Managers and seniors
// see the team's and everyone's; everyone else sees their own.
import "@/styles/updates.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Printer, RotateCcw, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { REPORT_BRAND } from "@/lib/reportBrand";
import { buildReportPdf, reportFileName } from "@/lib/reportPdf";
import { downloadPdf, printReport, sendPdf } from "@/lib/reportShare";
import {
  dayFromParam,
  generateUpdate,
  hasFacts,
  makeWeeklyUpdate,
  rangeLabel,
  useReport,
  weekIsOver,
  type PersonFacts,
  type ReportKind,
} from "@/lib/weeklyUpdates";
import { Loading, Spinner, useConfirm, useToast } from "@/components/ui";
import { REPORT_CSS, ReportDocument, reportNoun, reportTitle } from "./updates/ReportDocument";

const KINDS: ReportKind[] = ["week", "rolling", "custom"];

export default function UpdateReport() {
  const [params] = useSearchParams();
  const kind = (KINDS as string[]).includes(params.get("kind") ?? "") ? (params.get("kind") as ReportKind) : null;
  const start = dayFromParam(params.get("from"));
  const end = dayFromParam(params.get("to"));
  if (!kind || !start || !end || start > end) return <Navigate to="/updates?tab=week" replace />;
  return <Report kind={kind} start={start} end={end} who={params.get("who")} />;
}

function Report({ kind, start, end, who }: { kind: ReportKind; start: string; end: string; who: string | null }) {
  const { canAssign } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useReport(kind, start, end);
  const docRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"print" | "pdf" | "send" | "write" | null>(null);
  const [waiting, setWaiting] = useState(0);

  // Just the one person when asked (a link from a single person's update), else everything we can see.
  const view = useMemo(() => {
    const data = q.data ?? { team: null, people: [] };
    if (who) return { team: null, people: data.people.filter((p) => p.user_id === who) };
    return data;
  }, [q.data, who]);
  const rows = [...(view.team ? [view.team] : []), ...view.people];
  const writing = rows.some((r) => r.status === "pending") || (waiting > 0 && Date.now() - waiting < 180_000 && !rows.some((r) => r.updated_at && Date.parse(r.updated_at) > waiting));
  const over = kind === "week" ? weekIsOver(start) : true;
  const single = !view.team && view.people.length === 1 && hasFacts(view.people[0].facts) ? (view.people[0].facts as PersonFacts) : null;
  const title = `${REPORT_BRAND.name} ${reportTitle(kind, !!view.team, single)} ${rangeLabel(start, end, true)}`;
  const fileName = reportFileName(kind, start, end, single?.short_name);

  // While it's being written, look again every few seconds (live changes do the rest).
  const { refetch } = q;
  useEffect(() => {
    if (!writing) return;
    const t = window.setInterval(() => refetch(), 6000);
    return () => window.clearInterval(t);
  }, [writing, refetch]);

  // The PDF is made as soon as the report is in, so Send can open the share menu straight away.
  const version = rows.map((r) => `${r.id}:${r.updated_at}:${r.status}`).join("|");
  const [pdf, setPdf] = useState<{ version: string; blob: Blob } | null>(null);
  useEffect(() => {
    if (!rows.length || writing) return;
    let gone = false;
    buildReportPdf({ kind, start, end, team: view.team, people: view.people, over })
      .then((blob) => !gone && setPdf({ version, blob }))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, writing]);
  const pdfFor = async () => (pdf && pdf.version === version ? pdf.blob : buildReportPdf({ kind, start, end, team: view.team, people: view.people, over }));

  const onPrint = async () => {
    const el = docRef.current?.querySelector(".rp-doc") as HTMLElement | null;
    if (!el) return;
    setBusy("print");
    try {
      await printReport(el, REPORT_CSS, title);
    } catch {
      toast("It couldn't be printed. Try Download PDF and print that.", "error");
    } finally {
      setBusy(null);
    }
  };
  const onDownload = async () => {
    setBusy("pdf");
    try {
      downloadPdf(await pdfFor(), fileName);
    } catch {
      toast("The PDF couldn't be made. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };
  const onSend = async () => {
    setBusy("send");
    try {
      const r = await sendPdf(await pdfFor(), fileName, title);
      if (r === "saved") toast("Saved as a PDF. Attach it to your email or message.", "info");
    } catch {
      toast("The PDF couldn't be made. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };
  const canWrite = kind !== "rolling" && (canAssign || kind === "custom");
  const onWrite = async () => {
    if (
      rows.some((r) => r.status === "ready") &&
      !(await confirm({
        title: "Write it again?",
        message: "It's written again from the daily updates as they are now. Nobody is told again.",
        confirmLabel: "Write it again",
      }))
    )
      return;
    setBusy("write");
    try {
      if (kind === "week") await makeWeeklyUpdate({ week_start: start, user_id: who ?? undefined });
      else await generateUpdate({ start, end, user_id: who });
      setWaiting(Date.now());
      toast("Writing it now. It shows here in a minute or two.", "info");
      window.setTimeout(() => refetch(), 2000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "It didn't start. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const ready = rows.length > 0 && !rows.every((r) => r.status === "pending");
  return (
    <div className="page rp-page">
      <div className="rp-bar-top">
        <Link to="/updates?tab=week" className="btn small ghost">
          <ArrowLeft /> Weekly
        </Link>
        <span className="spacer" />
        <div className="rp-actions">
          <button className="btn small" type="button" onClick={onPrint} disabled={!ready || !!busy}>
            {busy === "print" ? <Spinner size={14} /> : <Printer />} Print
          </button>
          <button className="btn small" type="button" onClick={onDownload} disabled={!ready || !!busy}>
            {busy === "pdf" ? <Spinner size={14} /> : <Download />} PDF
          </button>
          <button className="btn small primary" type="button" onClick={onSend} disabled={!ready || !!busy}>
            {busy === "send" ? <Spinner size={14} /> : <Send />} Send
          </button>
          {canWrite && (
            <button className="btn small ghost" type="button" onClick={onWrite} disabled={writing || !!busy} title="Write it again">
              {busy === "write" || writing ? <Spinner size={14} /> : <RotateCcw />}
              <span className="rp-write-label">{writing ? "Being written" : "Write again"}</span>
            </button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <Loading rows={4} />
      ) : (
        <div ref={docRef}>
          <ReportDocument kind={kind} start={start} end={end} team={view.team} people={view.people} over={over} />
        </div>
      )}
      <p className="faint small rp-hint">
        {reportNoun(kind)} for {rangeLabel(start, end, true)}. Send opens your phone's share menu with the PDF; on a computer the PDF downloads.
      </p>
    </div>
  );
}
