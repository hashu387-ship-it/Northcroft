// The last 7 days, at the top of Home: written up every evening at 9:35 pm from the daily updates.
// Managers and seniors see the team's; everyone who sends daily updates sees their own. Opens the
// full report to print, download or send.
import "@/styles/updates.css";
import { Link } from "react-router-dom";
import { FileText, Sparkles } from "lucide-react";
import { useAuth, useMe } from "@/lib/auth";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import { hasFacts, rangeLabel, reportLink, useLastSevenDays, type PersonFacts, type TeamFacts } from "@/lib/weeklyUpdates";

export function LastSevenDaysCard() {
  const me = useMe();
  const { canAssign } = useAuth();
  const mine = sendsDailyUpdate(me);
  const show = canAssign || mine;
  const q = useLastSevenDays(me.id, canAssign, show);
  if (!show || q.isLoading || q.isError) return null;
  const row = q.data;

  if (!row) {
    return (
      <section className="glass card l7-card">
        <div className="l7-head">
          <span className="l7-ic">
            <Sparkles />
          </span>
          <div className="grow">
            <b>Last 7 days</b>
            <span className="faint small">Written up from the daily updates every evening at 9:35 pm. The first one comes tonight.</span>
          </div>
        </div>
      </section>
    );
  }

  const team = row.user_id === null;
  const tf = team && hasFacts(row.facts) ? (row.facts as TeamFacts) : null;
  const pf = !team && hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const words = row.summary ? ("headline" in row.summary ? row.summary.headline : row.summary.summary) : "";
  return (
    <section className="glass card l7-card">
      <div className="l7-head">
        <span className="l7-ic">
          <Sparkles />
        </span>
        <div className="grow">
          <b>Last 7 days</b>
          <span className="faint small">
            {rangeLabel(row.period_start, row.period_end)} · {team ? "the team" : "your work"} · refreshed every evening
          </span>
        </div>
        <Link to={reportLink("rolling", row.period_start, row.period_end, team ? null : me.id)} className="btn small">
          <FileText /> Open
        </Link>
      </div>
      {row.status === "pending" && !words && <p className="faint small du-none">Being written. It shows here in a minute or two.</p>}
      {row.status === "empty" && <p className="faint small du-none">No daily updates in the last 7 days.</p>}
      {tf && (
        <div className="l7-stats">
          <span>
            <b>
              {tf.sent_all}/{tf.people}
            </b>
            sent every day
          </span>
          <span>
            <b>{tf.moved}</b>
            moved on
          </span>
          <span>
            <b>{tf.handed_in}</b>
            handed in
          </span>
          <span className={tf.open_blockers.length ? "warn" : undefined}>
            <b>{tf.open_blockers.length}</b>
            blocked
          </span>
        </div>
      )}
      {pf && (
        <div className="l7-stats">
          <span>
            <b>
              {pf.days_sent}/{pf.days_expected}
            </b>
            daily updates
          </span>
          <span>
            <b>{pf.moved}</b>
            moved on
          </span>
          <span>
            <b>{pf.handed_in}</b>
            handed in
          </span>
          <span className={pf.open_blockers ? "warn" : undefined}>
            <b>{pf.open_blockers}</b>
            blocked
          </span>
        </div>
      )}
      {words && <p className="l7-text">{words}</p>}
    </section>
  );
}
