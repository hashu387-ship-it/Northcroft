import "@/styles/assist.css";
import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, Share2, Sparkles } from "lucide-react";
import { useProjects } from "@/lib/api";
import { assist, AssistError } from "@/lib/assist";
import { copyText } from "@/pages/settings/common";
import { Field, ProjectSelect, Segmented, Sheet, useToast } from "./ui";
import { WhatsAppIcon } from "./People";

/** The small sparkle used on every Claude button, so people learn what it means. */
export function ClaudeIcon({ size = 16 }: { size?: number }) {
  return <Sparkles size={size} className="claude-ico" aria-hidden />;
}

/** "Claude is working" with a gentle shimmer and a line saying roughly how long. */
function Thinking({ label }: { label: string }) {
  return (
    <div className="assist-thinking" role="status">
      <span className="assist-orb" aria-hidden>
        <ClaudeIcon size={18} />
      </span>
      <div>
        <div className="bold">{label}</div>
        <div className="assist-lines" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

/** Friendly message for errors, with a nudge to Hassan when Claude isn't switched on yet. */
function AssistProblem({ error, onRetry }: { error: AssistError; onRetry: () => void }) {
  const off = error.code === "off" || error.code === "bad_key";
  return (
    <div className="assist-problem">
      <p className="bold">{off ? "Claude isn't switched on yet" : "That didn't work"}</p>
      <p className="muted small">
        {off ? "A manager needs to add the Claude API key. Everything else in the app works as normal." : error.message}
      </p>
      {!off && (
        <button className="btn small" type="button" onClick={onRetry}>
          <RefreshCw /> Try again
        </button>
      )}
    </div>
  );
}

/** Claude's text, editable before it's copied or shared. */
function AssistResult({ text, onChange, shareTitle }: { text: string; onChange: (v: string) => void; shareTitle: string }) {
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(window.innerHeight * 0.55, el.scrollHeight + 4)}px`;
  }, [text]);

  async function copy() {
    toast((await copyText(text)) ? "Copied. Paste it into WhatsApp or an email." : "Couldn't copy. Select the text and copy it.", "info");
  }
  async function share() {
    try {
      await navigator.share({ title: shareTitle, text });
    } catch {
      /* closed the share sheet */
    }
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <textarea ref={ref} className="textarea assist-text" value={text} onChange={(e) => onChange(e.target.value)} aria-label={shareTitle} />
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" type="button" onClick={copy}>
          <Copy /> Copy
        </button>
        <a className="btn small wa-btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          <WhatsAppIcon /> WhatsApp
        </a>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button className="btn small ghost" type="button" onClick={share}>
            <Share2 /> Share
          </button>
        )}
      </div>
      <p className="faint tiny">Written by Claude from the app's tasks and messages. Check it before you send it.</p>
    </div>
  );
}

type Period = "1" | "3" | "7" | "14";

/** Status report writer: grouped by project and person, ready for WhatsApp or email. */
export function StatusReportSheet({ open, onClose, projectId = null }: { open: boolean; onClose: () => void; projectId?: string | null }) {
  const { data: projects = [] } = useProjects();
  const [project, setProject] = useState<string | null>(projectId);
  const [period, setPeriod] = useState<Period>("7");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AssistError | null>(null);

  useEffect(() => {
    if (!open) return;
    setProject(projectId);
    setText(null);
    setError(null);
  }, [open, projectId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await assist<{ text: string }>("status_report", { project_id: project, days: Number(period) });
      setText(r.text);
    } catch (e) {
      setError(e instanceof AssistError ? e : new AssistError(String(e)));
    } finally {
      setBusy(false);
    }
  }

  const name = project ? projects.find((p) => p.id === project)?.name : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="row" style={{ gap: 8 }}>
          <ClaudeIcon size={18} /> Status report
        </span>
      }
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" type="button" onClick={run} disabled={busy}>
            {text ? <RefreshCw /> : <ClaudeIcon />} {busy ? "Writing..." : text ? "Write again" : "Write the report"}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="form-grid">
          <Field label="Projects">
            <ProjectSelect value={project} onChange={setProject} projects={projects.filter((p) => p.status !== "completed")} emptyLabel="All active projects" />
          </Field>
          <Field label="Covering">
            <Segmented<Period>
              value={period}
              onChange={setPeriod}
              options={[
                { value: "1", label: "Today" },
                { value: "3", label: "3 days" },
                { value: "7", label: "Week" },
                { value: "14", label: "2 weeks" },
              ]}
            />
          </Field>
        </div>
        {busy ? (
          <Thinking label={`Reading ${name ?? "every project"}'s tasks, checklists and chats. This takes about 15 seconds.`} />
        ) : error ? (
          <AssistProblem error={error} onRetry={run} />
        ) : text !== null ? (
          <AssistResult text={text} onChange={setText} shareTitle={name ? `${name} status report` : "Status report"} />
        ) : (
          <p className="muted small">
            Claude writes it in your usual format: project, then each person with their email and what they did. It flags overdue work and anything waiting for
            your review, and never makes up progress.
          </p>
        )}
      </div>
    </Sheet>
  );
}

export type CatchUpScope = { kind: "team" } | { kind: "project"; projectId: string } | { kind: "task"; taskId: string };
type Days = "1" | "3" | "7";

/** "Catch me up": a short summary of a chat or a task's comments, written for whoever asks. */
export function CatchUpSheet({ open, onClose, scope, place }: { open: boolean; onClose: () => void; scope: CatchUpScope; place: string }) {
  const [days, setDays] = useState<Days>("3");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AssistError | null>(null);

  async function run(d: Days) {
    setBusy(true);
    setError(null);
    try {
      const r = await assist<{ text: string }>("chat_summary", {
        scope: scope.kind,
        project_id: scope.kind === "project" ? scope.projectId : undefined,
        task_id: scope.kind === "task" ? scope.taskId : undefined,
        days: Number(d),
      });
      setText(r.text);
    } catch (e) {
      setError(e instanceof AssistError ? e : new AssistError(String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Start straight away: opening it is the request.
  useEffect(() => {
    if (!open) return;
    setText(null);
    void run(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(d: Days) {
    setDays(d);
    void run(d);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="row" style={{ gap: 8 }}>
          <ClaudeIcon size={18} /> Catch up on {place}
        </span>
      }
      footer={
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Segmented<Days>
          value={days}
          onChange={pick}
          options={[
            { value: "1", label: "Last day" },
            { value: "3", label: "3 days" },
            { value: "7", label: "Week" },
          ]}
        />
        {busy ? (
          <Thinking label="Reading the messages and voice notes..." />
        ) : error ? (
          <AssistProblem error={error} onRetry={() => run(days)} />
        ) : text !== null ? (
          <div className="assist-summary">{text}</div>
        ) : null}
        {!busy && !error && text && <p className="faint tiny">Summarised by Claude. Open the chat for the full messages.</p>}
      </div>
    </Sheet>
  );
}
