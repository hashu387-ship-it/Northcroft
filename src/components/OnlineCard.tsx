// Home card: the whole team, you included: who has the app open right now, and when everyone else
// was last on.
// Tapping someone opens their profile card (Message, WhatsApp, Call).
import "@/styles/comms.css";
import { useMemo } from "react";
import { CircleDot } from "lucide-react";
import { usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { lastOnlineWhen, useClock, useLastOnline, useOnlineIds } from "@/lib/online";
import { openPersonCard } from "./People";
import { Avatar } from "./ui";

export function OnlineCard() {
  const me = useMe();
  const people = usePeople();
  const online = useOnlineIds();
  const seen = useLastOnline();
  const now = useClock();

  // Everyone on the team, you included. You first (you're here), then whoever else is online (by
  // name), then whoever was on most recently, then people with no time yet.
  const isOn = (id: string) => id === me.id || online.has(id);
  const list = useMemo(() => {
    const time = (id: string) => {
      const at = seen.get(id);
      return at ? new Date(at).getTime() : 0;
    };
    return [...people.active].sort((a, b) => {
      if (a.id === me.id) return -1;
      if (b.id === me.id) return 1;
      const ao = online.has(a.id);
      const bo = online.has(b.id);
      if (ao !== bo) return ao ? -1 : 1;
      if (!ao) {
        const d = time(b.id) - time(a.id);
        if (d) return d;
      }
      return a.short_name.localeCompare(b.short_name);
    });
  }, [people.active, me.id, online, seen]);

  if (!list.length) return null;
  const count = list.filter((p) => isOn(p.id)).length;

  return (
    <div className="glass card online-card">
      <div className="card-head">
        <h2 className="tone-green">
          <CircleDot /> Who's online
        </h2>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>
        {count > 1 ? `${count} online now, including you` : "Just you online right now"}
      </p>
      <div className="team-snap">
        {list.map((p) => {
          const on = isOn(p.id);
          const at = seen.get(p.id);
          return (
            <button type="button" className="person" key={p.id} onClick={() => openPersonCard(p.id)}>
              <Avatar person={p} size={30} />
              <span className="who">
                <b>
                  {p.short_name}
                  {p.id === me.id ? " (you)" : ""}
                </b>
                <span className={on ? "on" : undefined}>{on ? "Online" : at ? lastOnlineWhen(at, now) : "Offline"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
