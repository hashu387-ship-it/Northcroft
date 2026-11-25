// Calls: recent voice calls made and received in Northcroft, with Call back. /call/:id (from a
// "Saheeb is calling" notification) opens the ringing call, then shows this list.
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { unwrap, usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtTime12, todayISO, dateOf } from "@/lib/time";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Loading } from "@/components/ui";
import { calls, type CallRow } from "@/calls/engine";
import { useCall, useStartCall } from "@/calls/CallScreen";
import "@/styles/calls.css";

function length(c: CallRow) {
  if (!c.answered_at || !c.ended_at) return null;
  const s = Math.max(0, Math.round((Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

export default function Calls() {
  const me = useMe();
  const people = usePeople();
  const { id } = useParams();
  const navigate = useNavigate();
  const startCall = useStartCall();
  const state = useCall();

  // Opened from the notification: show the call if it's still ringing.
  useEffect(() => {
    if (!id) return;
    void calls.openFromLink(id).finally(() => navigate("/calls", { replace: true }));
  }, [id, navigate]);

  const list = useQuery({
    queryKey: ["calls", me.id, state.phase === "ended"],
    queryFn: () =>
      unwrap<CallRow[]>(
        supabase.from("calls").select("*").or(`caller_id.eq.${me.id},callee_id.eq.${me.id}`).order("created_at", { ascending: false }).limit(60),
      ),
  });

  return (
    <div className="page">
      <PageHead title="Calls" sub="Voice calls in Northcroft. Tap Call on someone's card or in a chat to call them." />
      <div className="glass card">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <Empty icon={<PhoneCall />} title="Calls aren't switched on yet">
            The calls list appears once the calls update is added to the database.
          </Empty>
        ) : !list.data?.length ? (
          <Empty icon={<PhoneCall />} title="No calls yet">
            Calls you make and receive show up here.
          </Empty>
        ) : (
          <div className="list">
            {list.data.map((c) => {
              const out = c.caller_id === me.id;
              const other = people.get(out ? c.callee_id : c.caller_id);
              const missed = !out && (c.status === "missed" || c.status === "cancelled");
              const day = dateOf(c.created_at);
              const Icon = missed ? PhoneMissed : out ? PhoneOutgoing : PhoneIncoming;
              const what =
                c.status === "ended" || c.status === "answered"
                  ? length(c) ?? (out ? "Outgoing" : "Incoming")
                  : missed
                    ? "Missed"
                    : c.status === "declined"
                      ? out ? "Declined" : "You declined"
                      : c.status === "busy"
                        ? "Busy"
                        : out
                          ? "No answer"
                          : "Missed";
              return (
                <div key={c.id} className="list-item call-row">
                  <Avatar person={other} size={40} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className={clsx("bold ellipsis", missed && "danger-text")}>{other?.short_name ?? "Former team member"}</div>
                    <div className="small muted">
                      <span className={clsx("call-dir", missed && "missed")}>
                        <Icon size={14} /> {what}
                      </span>
                      {" · "}
                      {day === todayISO() ? fmtTime12(c.created_at) : `${fmtDate(day)}, ${fmtTime12(c.created_at)}`}
                    </div>
                  </div>
                  {other?.active && (
                    <button type="button" className="btn small" onClick={() => void startCall(other.id)} aria-label={`Call ${other.short_name}`}>
                      <PhoneCall size={16} /> Call
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
