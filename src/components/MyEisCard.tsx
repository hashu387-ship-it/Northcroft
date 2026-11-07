// "My EIs" on Home: the open EIs (and other register items) where I'm the Northcroft responsible
// person, I'm assigned, or I have a sub task still to do, from every project. Tap one to open it.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, ClipboardList } from "lucide-react";
import { unwrap, useProjectMap } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { REGISTER_STATUS, sortItems } from "@/lib/registers";
import { supabase } from "@/lib/supabase";
import { diffDays, fmtDate, todayISO } from "@/lib/time";
import type { RegisterItem } from "@/lib/types";
import { Empty, Loading, Pill } from "@/components/ui";

const SHOW = 8;

function dueText(date: string | null, today: string) {
  if (!date) return null;
  const d = diffDays(date, today);
  if (d < 0) return d === -1 ? "1 day overdue" : `${-d} days overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${fmtDate(date, { day: "numeric", month: "short" })}`;
}

export function MyEisCard() {
  const me = useMe();
  const projects = useProjectMap();
  const today = todayISO();

  // Items with a sub task given to me that isn't done yet.
  const subs = useQuery({
    queryKey: ["register_subtasks", "home", me.id],
    queryFn: () =>
      unwrap<{ item_id: string }[]>(supabase.from("register_subtasks").select("item_id").eq("assignee_id", me.id).eq("done", false)),
  });
  const subItemIds = useMemo(() => [...new Set((subs.data ?? []).map((s) => s.item_id))].sort(), [subs.data]);

  const items = useQuery({
    queryKey: ["register_items", "home", me.id, subItemIds.join(",")],
    enabled: !subs.isLoading,
    queryFn: async () => {
      const mine = await unwrap<RegisterItem[]>(
        supabase.from("register_items").select("*").neq("status", "closed").or(`responsible_id.eq.${me.id},assignees.cs.{${me.id}}`),
      );
      const missing = subItemIds.filter((id) => !mine.some((i) => i.id === id));
      if (!missing.length) return mine;
      const viaSubs = await unwrap<RegisterItem[]>(supabase.from("register_items").select("*").neq("status", "closed").in("id", missing));
      return [...mine, ...viaSubs];
    },
  });

  const list = useMemo(() => sortItems(items.data ?? []), [items.data]);
  const subSet = useMemo(() => new Set(subItemIds), [subItemIds]);

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-indigo">
          <ClipboardList /> My EIs
        </h2>
        {list.length > 0 && <Pill tone="blue">{list.length} open</Pill>}
      </div>
      {items.isLoading || subs.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={<CircleCheck />} title="No open EIs for you">
          EIs where you're Northcroft responsible, assigned or have a sub task show here.
        </Empty>
      ) : (
        <div className="list">
          {list.slice(0, SHOW).map((i) => {
            const due = dueText(i.due_on, today);
            const late = !!i.due_on && i.due_on < today;
            const role = i.responsible_id === me.id ? "Northcroft responsible" : i.assignees.includes(me.id) ? "Assigned" : subSet.has(i.id) ? "Sub task" : null;
            const p = projects.get(i.project_id);
            return (
              <Link key={i.id} to={`/projects/${i.project_id}/registers?cat=${i.category_id}&item=${i.id}`} className={late ? "alert-row late" : "alert-row"}>
                <span className="tag" style={{ background: late ? "var(--red-soft)" : "var(--accent-soft)", color: late ? "var(--red)" : "var(--accent)" }}>
                  <ClipboardList />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: "block" }}>
                    {i.ref ? `${i.ref} ${i.title}` : i.title}
                  </span>
                  <span className="meta" style={{ display: "block" }}>
                    {[p?.code || p?.name || "Project", role, due].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Pill tone={late ? "red" : REGISTER_STATUS[i.status].tone}>{REGISTER_STATUS[i.status].label}</Pill>
              </Link>
            );
          })}
          {list.length > SHOW && <p className="muted small" style={{ margin: "6px 0 0" }}>{list.length - SHOW} more in your projects' EIs.</p>}
        </div>
      )}
    </div>
  );
}
