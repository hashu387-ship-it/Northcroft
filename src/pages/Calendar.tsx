import "@/styles/comms.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Trash2, Users } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, AvatarStack, Empty, Field, Loading, ProjectSelect, Segmented, Sheet, useConfirm, useToast } from "@/components/ui";
import { useInvalidate, usePeople, useProjectMap, useProjects, useSettings, useTasks } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { BOQ_STATUS, EVENT_KIND, VO_STATUS } from "@/lib/constants";
import { errorMessage, supabase } from "@/lib/supabase";
import {
  addDays,
  addMonths,
  DOW_SHORT,
  fmtClock,
  fmtLongDate,
  fmtMonth,
  isWorkday,
  monthStart,
  todayISO,
  weekStart,
} from "@/lib/time";
import type { CalendarEvent, EventKind } from "@/lib/types";
import { useBoqBetween, useEventsBetween, useVosBetween } from "./home/data";

type View = "month" | "agenda";
type Scope = "all" | "mine";

interface Item {
  id: string;
  date: string;
  kind: "event" | "task" | "boq" | "vo";
  title: string;
  sub: string;
  color: string;
  link?: string;
  event?: CalendarEvent;
  mine: boolean;
  sort: string;
}

const KIND_RANK = { event: "0", task: "1", vo: "2", boq: "3" } as const;
const TASK_COLOR = "#0A84FF";
const BOQ_COLOR = "#30B0C7";
const VO_COLOR = "#BF5AF2";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function Calendar() {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const settings = useSettings().data;
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const paramDate = params.get("date");
  const [selected, setSelected] = useState(isDate(paramDate) ? paramDate! : today);
  const [month, setMonth] = useState(monthStart(isDate(paramDate) ? paramDate! : today));
  const [view, setView] = useState<View>("month");
  const [scope, setScope] = useState<Scope>("all");
  const [eventSheet, setEventSheet] = useState<{ event: CalendarEvent | null; date: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDate(paramDate) && paramDate !== selected) {
      setSelected(paramDate!);
      setMonth(monthStart(paramDate!));
    }
  }, [paramDate]);

  const gridStart = weekStart(month);
  const lastOfMonth = addDays(addMonths(month, 1), -1);
  const gridEnd = addDays(weekStart(lastOfMonth), 6);
  const agendaStart = weekStart(selected);
  const agendaEnd = addDays(agendaStart, 27);
  const from = view === "month" ? gridStart : agendaStart;
  const to = view === "month" ? gridEnd : agendaEnd;

  const tasks = useTasks({ openOnly: true });
  const events = useEventsBetween(from, to);
  const boqs = useBoqBetween(from, to);
  const vos = useVosBetween(from, to);
  const loading = tasks.isLoading || events.isLoading || boqs.isLoading || vos.isLoading;

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const e of events.data ?? []) {
      const k = EVENT_KIND[e.kind];
      out.push({
        id: `e-${e.id}`,
        date: e.event_date,
        kind: "event",
        title: e.title,
        sub: [e.start_time ? `${fmtClock(e.start_time)}${e.end_time ? ` to ${fmtClock(e.end_time)}` : ""}` : "All day", k.label, e.location].filter(Boolean).join(" · "),
        color: k.color,
        event: e,
        mine: e.attendees.includes(me.id) || e.created_by === me.id,
        sort: `${KIND_RANK.event}${e.start_time ?? "00"}`,
      });
    }
    for (const t of tasks.data ?? []) {
      if (!t.due_date || t.due_date < from || t.due_date > to) continue;
      const project = projects.get(t.project_id);
      out.push({
        id: `t-${t.id}`,
        date: t.due_date,
        kind: "task",
        title: t.title,
        sub: ["Task due", people.get(t.assignee_id)?.short_name ?? "Unassigned", project?.name].filter(Boolean).join(" · "),
        color: project?.color ?? TASK_COLOR,
        link: `/tasks/${t.id}`,
        mine: t.assignee_id === me.id || t.created_by === me.id,
        sort: `${KIND_RANK.task}${t.title}`,
      });
    }
    for (const v of vos.data ?? []) {
      if (!v.response_due) continue;
      out.push({
        id: `v-${v.id}`,
        date: v.response_due,
        kind: "vo",
        title: `${v.vo_number} action due`,
        sub: [v.title, VO_STATUS[v.status].label, projects.get(v.project_id)?.name].filter(Boolean).join(" · "),
        color: VO_COLOR,
        link: `/projects/${v.project_id}/variations?vo=${v.id}`,
        mine: v.owner_id === me.id,
        sort: `${KIND_RANK.vo}${v.vo_number}`,
      });
    }
    for (const b of boqs.data ?? []) {
      if (!b.due_date) continue;
      out.push({
        id: `b-${b.id}`,
        date: b.due_date,
        kind: "boq",
        title: `${b.name} BOQ`,
        sub: [BOQ_STATUS[b.status].label, people.get(b.owner_id)?.short_name, projects.get(b.project_id)?.name].filter(Boolean).join(" · "),
        color: BOQ_COLOR,
        link: `/projects/${b.project_id}/boq`,
        mine: b.owner_id === me.id,
        sort: `${KIND_RANK.boq}${b.name}`,
      });
    }
    return out.filter((i) => scope === "all" || i.mine).sort((a, b) => a.sort.localeCompare(b.sort));
  }, [events.data, tasks.data, vos.data, boqs.data, from, to, scope, me.id, people, projects]);

  const byDate = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);

  function select(d: string, scroll = false) {
    setSelected(d);
    if (monthStart(d) !== month) setMonth(monthStart(d));
    setParams({ date: d }, { replace: true });
    if (scroll && window.matchMedia("(max-width: 1299px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function step(n: number) {
    if (view === "month") {
      const m = addMonths(month, n);
      setMonth(m);
      select(m === monthStart(today) ? today : m);
    } else {
      select(addDays(selected, n * 7));
    }
  }

  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const workDays = settings?.work_days ?? [0, 1, 2, 3, 4];
  const dayItems = byDate.get(selected) ?? [];

  return (
    <div className="page">
      <PageHead
        title="Calendar"
        sub="Deadlines, VO and BOQ dates, site visits and meetings"
        actions={
          <button className="btn primary" onClick={() => setEventSheet({ event: null, date: selected })}>
            <Plus /> Add event
          </button>
        }
      />

      <div className="cal-layout">
        <div className="glass card">
          <div className="cal-toolbar">
            <button className="icon-btn small" onClick={() => step(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"}>
              <ChevronLeft />
            </button>
            <button className="icon-btn small" onClick={() => step(1)} aria-label={view === "month" ? "Next month" : "Next week"}>
              <ChevronRight />
            </button>
            <h2>{view === "month" ? fmtMonth(month) : `From ${fmtLongDate(agendaStart).replace(/^\w+ /, "")}`}</h2>
            <button className="btn small ghost" onClick={() => select(today)}>
              Today
            </button>
            <span className="spacer" />
            <Segmented<Scope> value={scope} onChange={setScope} options={[{ value: "all", label: "Team" }, { value: "mine", label: "Mine" }]} />
            <Segmented<View> value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "agenda", label: "List" }]} />
          </div>

          {view === "month" ? (
            <>
              <div className="cal">
                {DOW_SHORT.map((d) => (
                  <div className="dow" key={d}>
                    {d}
                  </div>
                ))}
                {days.map((d) => {
                  const list = byDate.get(d) ?? [];
                  const shown = list.slice(0, 3);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={clsx(
                        "day",
                        !isWorkday(d, workDays) && "weekend",
                        monthStart(d) !== month && "other",
                        d === today && "today",
                        d === selected && "selected",
                      )}
                      onClick={() => select(d, true)}
                      aria-label={`${fmtLongDate(d)}, ${list.length} ${list.length === 1 ? "item" : "items"}`}
                      aria-pressed={d === selected}
                    >
                      <span className="d">{Number(d.slice(8, 10))}</span>
                      {shown.map((i) => (
                        <span
                          key={i.id}
                          className="chip"
                          style={{ background: `color-mix(in srgb, ${i.color} 16%, transparent)`, borderLeft: `3px solid ${i.color}` }}
                          title={`${i.title} · ${i.sub}`}
                        >
                          {i.title}
                        </span>
                      ))}
                      {list.length > 3 && <span className="more hide-mobile">+{list.length - 3} more</span>}
                      <span className="dots">
                        {list.slice(0, 4).map((i) => (
                          <i key={i.id} style={{ background: i.color }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="legend">
                <span>
                  <i className="dot-swatch" style={{ background: TASK_COLOR }} /> Task due (project colour)
                </span>
                <span>
                  <i className="dot-swatch" style={{ background: VO_COLOR }} /> VO action
                </span>
                <span>
                  <i className="dot-swatch" style={{ background: BOQ_COLOR }} /> BOQ due
                </span>
                {(Object.keys(EVENT_KIND) as EventKind[]).map((k) => (
                  <span key={k}>
                    <i className="dot-swatch" style={{ background: EVENT_KIND[k].color }} /> {EVENT_KIND[k].label}
                  </span>
                ))}
              </div>
            </>
          ) : loading ? (
            <Loading />
          ) : (
            <Agenda from={agendaStart} to={agendaEnd} byDate={byDate} onEvent={(e) => setEventSheet({ event: e, date: e.event_date })} />
          )}
        </div>

        <div ref={panelRef} className="glass day-panel">
          <div className="card-head">
            <h3>
              <CalendarDays /> {selected === today ? "Today" : fmtLongDate(selected)}
            </h3>
            <button className="btn small" onClick={() => setEventSheet({ event: null, date: selected })}>
              <Plus /> Event
            </button>
          </div>
          {selected === today && <div className="muted small" style={{ marginTop: -6, marginBottom: 8 }}>{fmtLongDate(today)}</div>}
          {loading ? (
            <Loading />
          ) : dayItems.length === 0 ? (
            <Empty icon={<CalendarDays />} title="Nothing on this day">
              {!isWorkday(selected, workDays) ? "It's a weekend day." : "Tap Event to add a meeting, site visit or submission."}
            </Empty>
          ) : (
            <div className="list">
              {dayItems.map((i) => (
                <DayItem key={i.id} item={i} onEvent={(e) => setEventSheet({ event: e, date: e.event_date })} />
              ))}
            </div>
          )}
          {!canAssign && scope === "all" && (
            <p className="faint tiny" style={{ marginTop: 10 }}>
              Showing the whole team. Switch to Mine to see only your items.
            </p>
          )}
        </div>
      </div>

      <EventForm
        open={!!eventSheet}
        event={eventSheet?.event ?? null}
        date={eventSheet?.date ?? selected}
        onClose={() => setEventSheet(null)}
        onSaved={(d) => select(d)}
      />
    </div>
  );
}

function DayItem({ item, onEvent }: { item: Item; onEvent: (e: CalendarEvent) => void }) {
  const people = usePeople();
  const body = (
    <>
      <span className="bar" style={{ background: item.color }} />
      <span className="grow">
        <span className="title" style={{ display: "block" }}>
          {item.title}
        </span>
        <span className="meta">{item.sub}</span>
      </span>
      {item.event && item.event.attendees.length > 0 && <AvatarStack people={item.event.attendees.map((id) => people.get(id))} size={22} max={3} />}
    </>
  );
  if (item.event) {
    return (
      <button type="button" className="day-item" onClick={() => onEvent(item.event!)}>
        {body}
      </button>
    );
  }
  return (
    <Link to={item.link ?? "#"} className="day-item">
      {body}
    </Link>
  );
}

function Agenda({
  from,
  to,
  byDate,
  onEvent,
}: {
  from: string;
  to: string;
  byDate: Map<string, Item[]>;
  onEvent: (e: CalendarEvent) => void;
}) {
  const today = todayISO();
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (byDate.get(d)?.length) days.push(d);
  if (!days.length) return <Empty icon={<CalendarDays />} title="Nothing scheduled in these four weeks" />;
  return (
    <div>
      {days.map((d) => (
        <div className="agenda-day" key={d}>
          <h3 className={clsx(d === today && "today")}>{d === today ? `Today · ${fmtLongDate(d)}` : fmtLongDate(d)}</h3>
          <div className="list">
            {byDate.get(d)!.map((i) => (
              <DayItem key={i.id} item={i} onEvent={onEvent} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventForm({
  open,
  event,
  date,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: CalendarEvent | null;
  date: string;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const { data: projectList = [] } = useProjects();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const canEdit = !event || event.created_by === me.id || canAssign;

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EventKind>("meeting");
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? "");
    setKind(event?.kind ?? "meeting");
    setDay(event?.event_date ?? date);
    setStart(event?.start_time?.slice(0, 5) ?? "");
    setEnd(event?.end_time?.slice(0, 5) ?? "");
    setLocation(event?.location ?? "");
    setProjectId(event?.project_id ?? null);
    setAttendees(event?.attendees ?? [me.id]);
    setNotes(event?.notes ?? "");
  }, [open, event, date, me.id]);

  const toggle = (id: string) => setAttendees((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  async function save() {
    if (!title.trim()) return toast("Give the event a title", "error");
    if (!day) return toast("Pick a date", "error");
    if (start && end && end <= start) return toast("The end time needs to be after the start", "error");
    setSaving(true);
    try {
      const fields = {
        title: title.trim(),
        kind,
        event_date: day,
        start_time: start || null,
        end_time: start && end ? end : null,
        location: location.trim() || null,
        project_id: projectId,
        attendees,
        notes: notes.trim() || null,
      };
      if (event) {
        const { error } = await supabase.from("events").update(fields).eq("id", event.id);
        if (error) throw error;
        toast("Event updated");
      } else {
        const { error } = await supabase.from("events").insert({ ...fields, created_by: me.id });
        if (error) throw error;
        const others = attendees.filter((a) => a !== me.id).length;
        toast(others ? `Event added. ${others} ${others === 1 ? "person was" : "people were"} notified.` : "Event added");
      }
      await invalidate("events");
      onSaved(day);
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    if (!(await confirm({ title: "Delete this event?", message: event.title, confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("events").delete().eq("id", event.id);
    if (error) return toast(errorMessage(error), "error");
    qc.setQueriesData<CalendarEvent[]>({ queryKey: ["events"] }, (old) => (Array.isArray(old) ? old.filter((x) => x.id !== event.id) : old));
    toast("Event deleted");
    await invalidate("events");
    onClose();
  }

  if (event && !canEdit) {
    const k = EVENT_KIND[event.kind];
    return (
      <Sheet open={open} onClose={onClose} title={event.title}>
        <div className="stack">
          <div className="row">
            <i className="dot-swatch" style={{ background: k.color }} />
            <b>{k.label}</b>
          </div>
          <div className="muted">
            {fmtLongDate(event.event_date)}
            {event.start_time ? `, ${fmtClock(event.start_time)}${event.end_time ? ` to ${fmtClock(event.end_time)}` : ""}` : ", all day"}
          </div>
          {event.location && (
            <div className="row muted">
              <MapPin size={16} /> {event.location}
            </div>
          )}
          {event.project_id && <div className="muted">{projects.get(event.project_id)?.name}</div>}
          {event.attendees.length > 0 && (
            <div className="row wrap">
              <Users size={16} className="muted" />
              {event.attendees.map((id) => (
                <span key={id} className="row" style={{ gap: 6 }}>
                  <Avatar person={people.get(id)} size={22} />
                  {people.get(id)?.short_name}
                </span>
              ))}
            </div>
          )}
          {event.notes && <p style={{ whiteSpace: "pre-wrap" }}>{event.notes}</p>}
          <p className="faint small">Added by {people.get(event.created_by)?.short_name ?? "someone"}. Only they or a senior can change it.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      footer={
        <>
          {event && (
            <button className="btn danger" onClick={remove} style={{ marginRight: "auto" }}>
              <Trash2 /> Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : event ? "Save changes" : "Add event"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Title" className="full">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!event} />
        </Field>
        <Field label="Type">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
            {(Object.keys(EVENT_KIND) as EventKind[]).map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Starts" hint="Leave empty for all day">
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!start} />
        </Field>
        <Field label="Location">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Project">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projectList} emptyLabel="No project" />
        </Field>
        <div className="full stack" style={{ gap: 8 }}>
          <div className="row">
            <span className="field-label">Who's involved</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn small ghost"
              onClick={() => setAttendees(attendees.length === people.active.length ? [me.id] : people.active.map((p) => p.id))}
            >
              {attendees.length === people.active.length ? "Just me" : "Everyone"}
            </button>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {people.active.map((p) => (
              <button key={p.id} type="button" className={clsx("chip-toggle", attendees.includes(p.id) && "on")} onClick={() => toggle(p.id)} aria-pressed={attendees.includes(p.id)}>
                <Avatar person={p} size={24} />
                {p.short_name}
              </button>
            ))}
          </div>
          <span className="faint tiny">Everyone you add gets a notification now and a reminder on the morning of the day.</span>
        </div>
        <Field label="Notes" className="full">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agenda, what to bring, contact on site" />
        </Field>
      </div>
    </Sheet>
  );
}
