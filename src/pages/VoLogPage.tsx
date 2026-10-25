// The VO log: every project's variations in one table, laid out like the team's VO log
// spreadsheet, with a project filter, status filter, search and an Excel download. Opening a VO
// shows the same form as a project's Variations tab (revisions, files, links, supporting
// documents), so whatever is changed or added here shows there too, and the other way round.
import "@/styles/tasks.css";
import "@/styles/volog.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, FileDiff, Paperclip, Search, X } from "lucide-react";
import clsx from "clsx";
import { useProjectMap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { VO_STATUS } from "@/lib/constants";
import { num, plural, sar } from "@/lib/format";
import { errorMessage } from "@/lib/supabase";
import { fmtDate } from "@/lib/time";
import type { Variation } from "@/lib/types";
import { latestRound, useVoFileCounts, voMatches, voRef } from "@/lib/volog";
import { buildVoLogWorkbook, saveBlob, voLogFileName } from "@/lib/vologExcel";
import { PageHead } from "@/components/PageHead";
import { Empty, Loading, Pill, Segmented, useToast } from "@/components/ui";
import { ordinal, voLogLine } from "./project/VoLog";
import { VoSheet } from "./project/Variations";
import { useVariations } from "./project/api";

type Group = "all" | "pending" | "approved" | "closed_out";

const dateOrDash = (iso: string | null | undefined) => (iso ? fmtDate(iso, { day: "numeric", month: "short", year: "2-digit" }) : "–");

/** "Rev 1 · 20 Oct 26", or the note the log has instead of a date. */
function sentText(v: Variation) {
  const last = latestRound(v);
  if (!last) return null;
  const subs = v.submissions ?? [];
  const name = last.rev?.trim() || `${ordinal(subs.length)} submission`;
  const when = last.sent ? dateOrDash(last.sent) : last.sent_note;
  return { name, when, of: subs.length };
}

export default function VoLogPage() {
  const { canAssign } = useAuth();
  const toast = useToast();
  const projects = useProjectMap();
  const { data: vos = [], isLoading } = useVariations();
  const counts = useVoFileCounts();
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState<Group>("all");
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const voParam = params.get("vo");
  const open = voParam ? vos.find((v) => v.id === voParam) ?? null : null;

  // Projects that have VOs, by name.
  const projectList = useMemo(() => {
    const ids = new Set(vos.map((v) => v.project_id));
    return projects.list.filter((p) => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [vos, projects.list]);

  const inProject = useMemo(() => (projectId ? vos.filter((v) => v.project_id === projectId) : vos), [vos, projectId]);
  const searched = useMemo(() => inProject.filter((v) => voMatches(v, projects.get(v.project_id), q)), [inProject, q, projects]);
  const shown = useMemo(() => {
    const list = group === "all" ? searched : searched.filter((v) => VO_STATUS[v.status].group === group);
    // Grouped by project, then in the order of the log (VO number).
    return [...list].sort(
      (a, b) =>
        (projects.get(a.project_id)?.name ?? "").localeCompare(projects.get(b.project_id)?.name ?? "") ||
        a.vo_number.localeCompare(b.vo_number, undefined, { numeric: true }),
    );
  }, [searched, group, projects]);
  const countIn = (g: Group) => (g === "all" ? searched.length : searched.filter((v) => VO_STATUS[v.status].group === g).length);

  const totals = useMemo(
    () => ({
      amount: shown.reduce((n, v) => n + (v.submitted_value ?? 0), 0),
      approved: shown.filter((v) => VO_STATUS[v.status].group === "approved").reduce((n, v) => n + (v.approved_value ?? 0), 0),
      open: shown.filter((v) => (v.log_status ?? "").trim().toLowerCase() === "open").length,
    }),
    [shown],
  );

  const openVo = (v: Variation) => {
    const next = new URLSearchParams(params);
    next.set("vo", v.id);
    setParams(next);
  };
  const closeVo = () => {
    const next = new URLSearchParams(params);
    next.delete("vo");
    setParams(next, { replace: true });
  };
  // A link to a VO that has gone (deleted) just shows the log.
  useEffect(() => {
    if (voParam && !isLoading && vos.length && !open) closeVo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voParam, isLoading, vos.length, open]);

  async function download() {
    setBusy(true);
    try {
      const blob = await buildVoLogWorkbook(shown, projects.byId, counts.data ?? new Map());
      saveBlob(blob, voLogFileName());
      toast(`VO log downloaded, ${plural(shown.length, "VO")}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const files = (v: Variation) => counts.data?.get(v.id) ?? 0;

  return (
    <div className="page vlog-page">
      <PageHead
        title="VO log"
        sub="Every project's variations in one place, laid out like the VO log. Open a VO to update it or add its files and links; it's the same VO as in the project."
      />

      <div className="vo-stats vlog-stats">
        <div className="glass stat">
          <span className="label">VOs shown</span>
          <span className="value">{shown.length}</span>
          <span className="hint">{totals.open ? `${totals.open} open in the log` : projectId ? projects.get(projectId)?.name : "All projects"}</span>
        </div>
        <div className="glass stat">
          <span className="label">Amount</span>
          <span className="value">{sar(totals.amount, { compact: true, blank: "SAR 0" })}</span>
          <span className="hint">What was submitted, for the VOs shown</span>
        </div>
        <div className="glass stat">
          <span className="label">Approved</span>
          <span className="value">{sar(totals.approved, { compact: true, blank: "SAR 0" })}</span>
          <span className="hint">Approved, agreed and closed VOs</span>
        </div>
      </div>

      <div className="glass card vlog-filters">
        <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="vlog-search">
          <Search aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, subject, scope or remarks" aria-label="Search the VO log" />
          {q && (
            <button type="button" className="icon-btn small plain" onClick={() => setQ("")} aria-label="Clear the search">
              <X />
            </button>
          )}
        </label>
        <button className="btn primary" type="button" onClick={download} disabled={busy || !shown.length}>
          <FileDown /> {busy ? "Preparing..." : "Download as Excel"}
        </button>
      </div>

      <div className="vlog-groups">
        <Segmented<Group>
          value={group}
          onChange={setGroup}
          options={[
            { value: "all", label: "All", count: countIn("all") },
            { value: "pending", label: "Pending", count: countIn("pending") },
            { value: "approved", label: "Approved", count: countIn("approved") },
            { value: "closed_out", label: "Rejected", count: countIn("closed_out") },
          ]}
        />
        <span className="faint small hide-mobile">Values in SAR · tap a row to open the VO</span>
      </div>

      {isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="glass">
          <Empty icon={<FileDiff />} title={vos.length ? "No VOs match" : "No variations yet"}>
            {vos.length ? "Try another project, status or search." : "VOs added in a project's Variations tab show here."}
          </Empty>
        </div>
      ) : (
        <>
          <div className="solid vlog-table">
            <div className="vlog-wrap">
              <table className="table vlog">
                <thead>
                  <tr>
                    <th className="c-sr">Sr</th>
                    <th className="c-ref">Reference</th>
                    <th>Project</th>
                    <th>Subject</th>
                    <th>Scope</th>
                    <th>Instruction</th>
                    <th>Contractual submission</th>
                    <th>Latest submission</th>
                    <th className="r">Our amount</th>
                    <th className="r">ECJV assessed</th>
                    <th>ECJV response</th>
                    <th>Response date</th>
                    <th className="r">Amount</th>
                    <th>Expected completion</th>
                    <th>Status</th>
                    <th>QS remarks</th>
                    <th className="r">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v, i) => {
                    const last = latestRound(v);
                    const sent = sentText(v);
                    const p = projects.get(v.project_id);
                    return (
                      <tr key={v.id} className="clickable" onClick={() => openVo(v)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openVo(v)}>
                        <td className="c-sr num">{i + 1}</td>
                        <td className="c-ref">
                          <b className="vlog-ref">{voRef(v)}</b>
                          {v.log_ref && v.log_ref.trim() !== v.vo_number && <span className="faint tiny">{v.vo_number}</span>}
                        </td>
                        <td className="nowrap">
                          <span className="vlog-dot" style={{ background: p?.color ?? "var(--text-3)" }} />
                          {p?.name ?? "–"}
                        </td>
                        <td className="c-long">
                          <div className="clamp-2" title={v.title}>
                            {v.title}
                          </div>
                        </td>
                        <td className="c-mid">{v.scope || "–"}</td>
                        <td className="nowrap">{dateOrDash(v.instruction_date)}</td>
                        <td className="nowrap">{dateOrDash(v.contract_due)}</td>
                        <td className="nowrap">
                          {sent ? (
                            <>
                              <b>{sent.name}</b>
                              {sent.when ? <span className="muted"> · {sent.when}</span> : null}
                              {sent.of > 1 && <div className="faint tiny">{plural(sent.of, "submission")} in all</div>}
                            </>
                          ) : (
                            <span className="faint">Not sent yet</span>
                          )}
                        </td>
                        <td className="r money">{num(last?.submitted_value)}</td>
                        <td className="r money">{num(last?.assessed_value)}</td>
                        <td className="c-long">
                          <div className="clamp-3" title={last?.response ?? ""}>
                            {last?.response || "–"}
                          </div>
                        </td>
                        <td className="nowrap">{dateOrDash(last?.response_on)}</td>
                        <td className="r money bold">{num(v.submitted_value)}</td>
                        <td className="nowrap">{dateOrDash(v.expected_completion)}</td>
                        <td className="nowrap">
                          {v.log_status && <div className="small bold">{v.log_status}</div>}
                          <Pill tone={VO_STATUS[v.status].tone}>{VO_STATUS[v.status].label}</Pill>
                        </td>
                        <td className="c-long">
                          <div className="clamp-3" title={v.qs_remarks ?? ""}>
                            {v.qs_remarks || "–"}
                          </div>
                        </td>
                        <td className="r nowrap">
                          {files(v) ? (
                            <span className="vlog-files" title={`${plural(files(v), "file or link", "files and links")}`}>
                              <Paperclip size={13} /> {files(v)}
                            </span>
                          ) : (
                            <span className="faint">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={12}>Total amount, {plural(shown.length, "VO")}</td>
                    <td className="r money">{num(totals.amount)}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="vlog-cards">
            {shown.map((v) => {
              const p = projects.get(v.project_id);
              const last = latestRound(v);
              const line = voLogLine(v);
              return (
                <button key={v.id} type="button" className="vo-card vlog-card" onClick={() => openVo(v)}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <b className="vlog-ref">{voRef(v)}</b>
                    <Pill tone={VO_STATUS[v.status].tone}>{VO_STATUS[v.status].label}</Pill>
                    <span className="spacer" />
                    {files(v) > 0 && (
                      <span className="vlog-files">
                        <Paperclip size={13} /> {files(v)}
                      </span>
                    )}
                  </div>
                  <span className="faint tiny row" style={{ gap: 6 }}>
                    <span className="vlog-dot" style={{ background: p?.color ?? "var(--text-3)" }} />
                    {p?.name ?? "–"}
                    {v.scope ? ` · ${v.scope}` : ""}
                  </span>
                  <div className="clamp-2" style={{ fontWeight: 550 }}>
                    {v.title}
                  </div>
                  {line && <div className="faint small">{line}</div>}
                  <div className="vals">
                    <span>
                      Amount<b>{sar(v.submitted_value, { compact: true })}</b>
                    </span>
                    <span>
                      ECJV assessed<b>{sar(last?.assessed_value ?? null, { compact: true })}</b>
                    </span>
                    <span>
                      Expected<b>{v.expected_completion ? fmtDate(v.expected_completion) : "–"}</b>
                    </span>
                  </div>
                  {v.qs_remarks && <div className={clsx("small clamp-2", "muted")}>{v.qs_remarks}</div>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {open && projects.get(open.project_id) && (
        <VoSheet open onClose={closeVo} project={projects.get(open.project_id)!} vo={open} suggestedNumber={open.vo_number} canDelete={canAssign} />
      )}
    </div>
  );
}
