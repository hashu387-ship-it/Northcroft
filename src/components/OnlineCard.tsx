// Home card: who has the app open right now, and when everyone else was last on.
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

  // Online first (by name), then whoever was on most recently, then people with no time yet.
  const list = useMemo(() => {
    const time = (id: string) => {
      const at = seen.get(id);
      return at ? new Date(at).getTime() : 0;
    };
    return people.active
      .filter((p) => p.id !== me.id)
      .sort((a, b) => {
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
  const count = list.filter((p) => online.has(p.id)).length;

  return (
    <div className="glass card online-card">
      <div className="card-head">
        <h2 className="tone-green">
          <CircleDot /> Who's online
        </h2>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>
        {count ? `${count} online now` : "Nobody else is online right now"}
      </p>
      <div className="team-snap">
        {list.map((p) => {
          const on = online.has(p.id);
          const at = seen.get(p.id);
          return (
            <button type="button" className="person" key={p.id} onClick={() => openPersonCard(p.id)}>
              <Avatar person={p} size={30} />
              <span className="who">
                <b>{p.short_name}</b>
                <span className={on ? "on" : undefined}>{on ? "Online" : at ? lastOnlineWhen(at, now) : "Offline"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
