// A project's EIs and other registers (RFIs, Claims, Letters...). EIs are in every project; managers
// and seniors add the others. Each item has a reference, title, dates, a status, the Northcroft
// responsible person and the people assigned. Its files and links are kept in its own folder in the
// project's Files (Files > EIs > EI-242 Hardscaping), so they show there too.
import "@/styles/registers.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Check, ClipboardList, FolderOpen, ListChecks, Paperclip, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { isProjectLevelFile, isProjectLevelLink, useProjectFolders } from "@/lib/projectFolders";
import {
  FIRST_STATUSES,
  REGISTER_STATUS,
  REGISTER_STATUSES,
  addCategory,
  addItem,
  addSubtask,
  categoryError,
  itemFolder,
  itemLabel,
  itemNoun,
  removeCategory,
  removeItem,
  removeSubtask,
  renameCategory,
  sortItems,
  updateItem,
  updateSubtask,
  useRegisterCategories,
  useRegisterItems,
  useRegisterSubtasks,
  type ItemValues,
} from "@/lib/registers";
import { errorMessage } from "@/lib/supabase";
import { fmtDate, todayISO } from "@/lib/time";
import type { Profile, Project, RegisterCategory, RegisterItem, RegisterStatus, RegisterSubtask } from "@/lib/types";
import { Attachments } from "@/components/Attachments";
import { DriveLinks } from "@/components/DriveLinks";
import { Empty, Field, Loading, PeopleSelect, PersonSelect, Pill, Segmented, Sheet, useConfirm, useToast } from "@/components/ui";

type View = "open" | "mine" | "closed" | "all";

const dateText = (iso: string | null) => (iso ? fmtDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
const late = (i: RegisterItem, today: string) => i.status !== "closed" && !!i.due_on && i.due_on < today;
const names = (ids: string[], people: Map<string, Profile>) =>
  ids
    .map((id) => people.get(id)?.short_name)
    .filter(Boolean)
    .join(", ");

export function Registers({ project }: { project: Project }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const invalidate = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const cats = useRegisterCategories(project.id);
  const items = useRegisterItems(project.id);
  const subtasks = useRegisterSubtasks(project.id);
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [catSheet, setCatSheet] = useState<{ open: boolean; category: RegisterCategory | null }>({ open: false, category: null });
  // One just added shows straight away, before the list has reloaded with it.
  const [made, setMade] = useState<RegisterItem | null>(null);
  const today = todayISO();

  const catList = cats.data ?? [];
  const category = catList.find((c) => c.id === params.get("cat")) ?? catList[0];
  const all = items.data ?? [];
  const itemId = params.get("item");
  const openItem = itemId ? all.find((i) => i.id === itemId) ?? (made?.id === itemId ? made : null) : null;
  const isNew = params.get("new") === "1";
  const noun = itemNoun(category);

  const setParam = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  };

  // A link to an item that has gone just shows the list.
  useEffect(() => {
    if (itemId && !items.isLoading && items.data && !openItem) setParam({ item: null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, items.isLoading, items.data, openItem]);

  const inCat = useMemo(() => all.filter((i) => i.category_id === category?.id), [all, category?.id]);
  const subsOf = useMemo(() => {
    const m = new Map<string, RegisterSubtask[]>();
    for (const t of subtasks.data ?? []) m.set(t.item_id, [...(m.get(t.item_id) ?? []), t]);
    return m;
  }, [subtasks.data]);
  const mine = (i: RegisterItem) =>
    i.responsible_id === me.id || i.assignees.includes(me.id) || (subsOf.get(i.id) ?? []).some((t) => !t.done && t.assignee_id === me.id);
  const counts = {
    open: inCat.filter((i) => i.status !== "closed").length,
    mine: inCat.filter((i) => i.status !== "closed" && mine(i)).length,
    closed: inCat.filter((i) => i.status === "closed").length,
    all: inCat.length,
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = inCat.filter((i) => {
      if (view === "open" && i.status === "closed") return false;
      if (view === "closed" && i.status !== "closed") return false;
      if (view === "mine" && (i.status === "closed" || !mine(i))) return false;
      if (!needle) return true;
      return [i.ref, i.title, i.description, i.notes, ...(subsOf.get(i.id) ?? []).map((t) => t.title)].some((t) => t?.toLowerCase().includes(needle));
    });
    return sortItems(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCat, view, q, me.id, subsOf]);

  async function dropCategory(c: RegisterCategory) {
    const n = all.filter((i) => i.category_id === c.id).length;
    if (n) {
      toast(`${c.name} still has ${n} ${n === 1 ? "item" : "items"}. Remove them first.`, "error");
      return;
    }
    if (!(await confirm({ title: `Remove ${c.name}?`, message: `${c.name} goes from ${project.code ?? project.name}. Its folder stays in Files.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      await removeCategory(c.id);
      setParam({ cat: null, item: null });
      toast(`${c.name} removed`);
      await invalidate("register_categories");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (cats.isLoading) return <Loading />;
  if (!category) {
    return (
      <div className="glass">
        <Empty icon={<ClipboardList />} title="EIs aren't set up for this project yet">
          They appear here as soon as the database update for EIs and registers is in.
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack reg-page" style={{ gap: 10 }}>
      <div className="reg-cats" role="tablist" aria-label="Registers">
        {catList.map((c) => {
          const n = all.filter((i) => i.category_id === c.id && i.status !== "closed").length;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === category.id}
              className={clsx("reg-cat", c.id === category.id && "on")}
              onClick={() => setParam({ cat: c.id, item: null, new: null })}
            >
              {c.name}
              {n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
        {canAssign && (
          <button type="button" className="reg-cat add" onClick={() => setCatSheet({ open: true, category: null })}>
            <Plus /> Category
          </button>
        )}
      </div>

      <div className="view-head">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "Open", count: counts.open },
            { value: "mine", label: "Mine", count: counts.mine },
            { value: "closed", label: "Closed", count: counts.closed },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
        <label className="reg-search">
          <Search />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${category.name}`} aria-label={`Search ${category.name}`} />
          {q && (
            <button type="button" className="icon-btn small" onClick={() => setQ("")} aria-label="Clear the search">
              <X />
            </button>
          )}
        </label>
        <span className="spacer" />
        {canAssign && !category.builtin && (
          <>
            <button type="button" className="btn small ghost" onClick={() => setCatSheet({ open: true, category })}>
              <Pencil /> Rename
            </button>
            <button type="button" className="btn small ghost" onClick={() => dropCategory(category)}>
              <Trash2 /> Remove
            </button>
          </>
        )}
        <button className="btn brand small" type="button" onClick={() => setParam({ new: "1", item: null })}>
          <Plus /> Add {noun}
        </button>
      </div>

      {items.isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="glass">
          <Empty icon={<ClipboardList />} title={inCat.length === 0 ? `No ${category.name} yet` : view === "mine" ? `No open ${category.name} for you` : `No ${category.name} match`}>
            {inCat.length === 0
              ? `Add the first ${noun} for ${project.code ?? project.name}: its reference, the Northcroft responsible person, who's on it, and its files.`
              : view === "mine"
                ? `Nothing open where you're the Northcroft responsible person or assigned.`
                : "Try another filter or search."}
          </Empty>
        </div>
      ) : (
        <>
          <div className="glass solid reg-table hide-mobile">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Northcroft responsible</th>
                    <th>Assigned</th>
                    <th>Received</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id} className={clsx("clickable", i.status === "closed" && "closed")} onClick={() => setParam({ item: i.id, new: null })}>
                      <td className="reg-ref">{i.ref ?? <span className="faint">None</span>}</td>
                      <td className="reg-title">
                        {i.title}
                        <SubCount list={subsOf.get(i.id)} />
                      </td>
                      <td>
                        <Pill tone={REGISTER_STATUS[i.status].tone}>{REGISTER_STATUS[i.status].label}</Pill>
                      </td>
                      <td>{people.get(i.responsible_id)?.short_name ?? <span className="faint">Not set</span>}</td>
                      <td>{names(i.assignees, people.byId) || <span className="faint">Nobody</span>}</td>
                      <td>{dateText(i.received_on)}</td>
                      <td className={clsx(late(i, today) && "reg-late")}>{dateText(i.due_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass reg-cards hide-desktop">
            {shown.map((i) => {
              const who = people.get(i.responsible_id)?.short_name;
              const subs = subsOf.get(i.id) ?? [];
              const meta = [
                who ? `Northcroft: ${who}` : null,
                names(i.assignees, people.byId) || null,
                subs.length ? `${subs.filter((t) => t.done).length}/${subs.length} sub tasks` : null,
                i.due_on ? `Due ${fmtDate(i.due_on, { weekday: "short", day: "numeric", month: "short" })}` : null,
              ].filter(Boolean);
              return (
                <button key={i.id} type="button" className={clsx("reg-row", i.status === "closed" && "closed", late(i, today) && "late")} onClick={() => setParam({ item: i.id, new: null })}>
                  <span className="grow">
                    <span className="t">{itemLabel(i)}</span>
                    <span className={clsx("m", late(i, today) && "reg-late")}>{meta.join(" · ") || "Nobody on it yet"}</span>
                  </span>
                  <Pill tone={REGISTER_STATUS[i.status].tone}>{REGISTER_STATUS[i.status].label}</Pill>
                </button>
              );
            })}
          </div>
        </>
      )}

      <ItemSheet
        open={!!openItem || isNew}
        onClose={() => setParam({ item: null, new: null }, true)}
        project={project}
        category={category}
        item={openItem}
        subtasks={openItem ? subsOf.get(openItem.id) ?? [] : []}
        // Sub tasks and the extra statuses need the 0050 database update; until it's in, they stay hidden.
        upgraded={subtasks.isSuccess}
        onCreated={(i) => {
          setMade(i);
          setParam({ new: null, item: i.id }, true);
        }}
      />
      <CategorySheet
        open={catSheet.open}
        onClose={() => setCatSheet({ open: false, category: null })}
        projectId={project.id}
        category={catSheet.category}
        onSaved={(c) => setParam({ cat: c.id, item: null, new: null })}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- one item */

const empty = (): ItemValues => ({
  ref: "",
  title: "",
  description: "",
  status: "open",
  received_on: todayISO(),
  due_on: "",
  responsible_id: null,
  assignees: [],
  notes: "",
});

const valuesOf = (i: RegisterItem): ItemValues => ({
  ref: i.ref ?? "",
  title: i.title,
  description: i.description ?? "",
  status: i.status,
  received_on: i.received_on ?? "",
  due_on: i.due_on ?? "",
  responsible_id: i.responsible_id,
  assignees: i.assignees,
  notes: i.notes ?? "",
});

function ItemSheet({
  open,
  onClose,
  project,
  category,
  item,
  subtasks,
  upgraded,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  category: RegisterCategory;
  item: RegisterItem | null;
  subtasks: RegisterSubtask[];
  upgraded: boolean;
  onCreated: (i: RegisterItem) => void;
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const folders = useProjectFolders(project.id);
  const [f, setF] = useState<ItemValues>(empty);
  const [saving, setSaving] = useState(false);
  const noun = itemNoun(category);
  const asked = useRef<string | null>(null);

  // Fill the form when it opens, or when a different item opens.
  useEffect(() => {
    if (!open) return;
    setF(item ? valuesOf(item) : empty());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  // The item's folder in Files: made again if someone removed it there.
  const folderId = item?.folder_id && folders.byId.has(item.folder_id) ? item.folder_id : null;
  useEffect(() => {
    if (!open || !item || folders.loading || folderId || asked.current === item.id) return;
    asked.current = item.id;
    itemFolder(item.id)
      .then(() => invalidate("register_items", "project_folders"))
      .catch(() => undefined);
  }, [open, item, folders.loading, folderId, invalidate]);

  const set = <K extends keyof ItemValues>(k: K, v: ItemValues[K]) => setF((x) => ({ ...x, [k]: v }));
  const changed = !item || JSON.stringify(valuesOf(item)) !== JSON.stringify(f);
  const canRemove = !!item && (canAssign || item.created_by === me.id);
  const problem = !f.title.trim() ? "Give it a title." : f.due_on && f.received_on && f.due_on < f.received_on ? "The due date comes before the date it came in." : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      if (item) {
        await updateItem(item.id, f);
        toast(`${itemLabel({ ref: f.ref.trim() || null, title: f.title.trim() })} saved`);
      } else {
        const made = await addItem(category, f);
        toast(`${itemLabel(made)} added. You can add its files now.`);
        onCreated(made);
      }
      await invalidate("register_items", "project_folders", "notifications");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    const ok = await confirm({
      title: `Remove ${itemLabel(item)}?`,
      message: "It goes from this register. Its files and links stay in the project's Files, in its folder.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeItem(item.id);
      toast(`${itemLabel(item)} removed`);
      onClose();
      await invalidate("register_items", "project_folders");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const folderPath = folderId ? folders.path(folderId).map((x) => x.name).join(" › ") : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={item ? itemLabel(item) : `Add ${noun}`}
      wide
      footer={
        <>
          {canRemove && (
            <button className="btn ghost danger-text" type="button" onClick={remove} disabled={saving}>
              <Trash2 /> Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            {item && !changed ? "Close" : "Cancel"}
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={saving || !!problem || !changed}>
            {item ? "Save" : `Add ${noun}`}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="form-grid">
          <Field label="Reference">
            <input className="input" value={f.ref} onChange={(e) => set("ref", e.target.value)} placeholder={category.prefix ? `${category.prefix}-242` : "Reference"} maxLength={40} />
          </Field>
          <Field label="Status">
            <select className="select" value={f.status} onChange={(e) => set("status", e.target.value as RegisterStatus)}>
              {(upgraded ? REGISTER_STATUSES : REGISTER_STATUSES.filter((s) => FIRST_STATUSES.includes(s) || s === f.status)).map((s) => (
                <option key={s} value={s}>
                  {REGISTER_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" className="full">
            <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={category.builtin ? "Hardscaping take-off" : "What it's about"} maxLength={300} />
          </Field>
          <Field label="Came in">
            <input className="input" type="date" value={f.received_on} onChange={(e) => set("received_on", e.target.value)} />
          </Field>
          <Field label="Due">
            <input className="input" type="date" value={f.due_on} onChange={(e) => set("due_on", e.target.value)} />
          </Field>
          <Field label="Northcroft responsible" className="full" hint="They're told when it's added, given to them, when its status moves and when files come in.">
            <PersonSelect value={f.responsible_id} onChange={(v) => set("responsible_id", v)} people={people.active} placeholder="Not set yet" />
          </Field>
          <Field label="Assigned to" className="full" group>
            <PeopleSelect value={f.assignees} onChange={(v) => set("assignees", v)} people={people.active} empty="Nobody yet" />
          </Field>
          <Field label="Description" className="full">
            <textarea className="textarea" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} />
          </Field>
          <Field label="Notes" className="full">
            <textarea className="textarea" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />
          </Field>
        </div>
        {problem && (f.title || f.due_on) && <p className="small" style={{ color: "var(--red)", margin: 0 }}>{problem}</p>}

        {upgraded && <SubtaskList item={item} noun={noun} list={subtasks} />}

        <section className="reg-files">
          <h3 className="reg-h">
            <Paperclip /> Files and links
          </h3>
          {!item ? (
            <p className="muted small">Add the {noun} first, then its files and links go here.</p>
          ) : !folderId ? (
            <Loading rows={1} />
          ) : (
            <>
              {folderPath && (
                <p className="muted small reg-folder">
                  <FolderOpen /> Also in Files: {folderPath}
                </p>
              )}
              <Attachments
                projectId={project.id}
                projectFolderId={folderId}
                filter={(a) => isProjectLevelFile(a) && a.project_folder_id === folderId}
                canUpload
                compact
                emptyText="No files yet"
              />
              <DriveLinks projectId={project.id} projectFolderId={folderId} filter={(l) => isProjectLevelLink(l) && l.project_folder_id === folderId} compact />
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- sub tasks */

/** "1/2 sub tasks" under a title in the list. */
function SubCount({ list }: { list: RegisterSubtask[] | undefined }) {
  if (!list?.length) return null;
  const done = list.filter((t) => t.done).length;
  return (
    <span className={clsx("reg-subcount", done === list.length && "all")}>
      <ListChecks /> {done}/{list.length} sub tasks
    </span>
  );
}

function SubtaskList({ item, noun, list }: { item: RegisterItem | null; noun: string; list: RegisterSubtask[] }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setTitle("");
    setWho(null);
  }, [item?.id]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await invalidate("register_subtasks", "notifications");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    if (!item || !title.trim()) return;
    const sort = list.reduce((m, t) => Math.max(m, t.sort), 0) + 1;
    return run("add", async () => {
      await addSubtask(item, title, who, me.id, sort);
      setTitle("");
      setWho(null);
    });
  };

  const done = list.filter((t) => t.done).length;
  return (
    <section className="reg-subs">
      <h3 className="reg-h">
        <ListChecks /> Sub tasks
        {list.length > 0 && (
          <span className="muted small">
            {done} of {list.length} done
          </span>
        )}
      </h3>
      {!item ? (
        <p className="muted small">Add the {noun} first, then its sub tasks go here.</p>
      ) : (
        <>
          {list.length > 0 && (
            <ul className="reg-sublist">
              {list.map((t) => {
                const person = people.get(t.assignee_id)?.short_name;
                const canRemove = canAssign || t.created_by === me.id;
                return (
                  <li key={t.id} className={clsx(t.done && "done")}>
                    <button
                      type="button"
                      className={clsx("reg-tick", t.done && "on")}
                      role="checkbox"
                      aria-checked={t.done}
                      aria-label={t.done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                      disabled={busy === t.id}
                      onClick={() => run(t.id, () => updateSubtask(t.id, { done: !t.done }))}
                    >
                      {t.done && <Check />}
                    </button>
                    <span className="grow">
                      <span className="t">{t.title}</span>
                      <span className="m">
                        {person ?? "Nobody on it"}
                        {t.done && t.done_by ? ` · done by ${people.get(t.done_by)?.short_name ?? "someone"}` : ""}
                      </span>
                    </span>
                    {canRemove && (
                      <button type="button" className="icon-btn small" aria-label={`Remove "${t.title}"`} disabled={busy === t.id} onClick={() => run(t.id, () => removeSubtask(t.id))}>
                        <Trash2 />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="reg-subadd">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Add a sub task, e.g. paint take-off from the shop drawing"
              maxLength={300}
              aria-label="New sub task"
            />
            <PersonSelect value={who} onChange={setWho} people={people.active} placeholder="Who's on it" aria-label="Who's on the sub task" />
            <button type="button" className="btn small" onClick={add} disabled={!title.trim() || busy === "add"}>
              <Plus /> Add
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- a category */

function CategorySheet({
  open,
  onClose,
  projectId,
  category,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  category: RegisterCategory | null;
  onSaved: (c: RegisterCategory) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setPrefix(category?.prefix ?? "");
  }, [open, category]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (category) {
        await renameCategory(category.id, name, prefix);
        toast(`Renamed to ${name.trim()}`);
        onSaved(category);
      } else {
        const c = await addCategory(projectId, name, prefix, me.id);
        toast(`${c.name} added`);
        onSaved(c);
      }
      await invalidate("register_categories", "project_folders");
      onClose();
    } catch (e) {
      toast(categoryError(e) ?? errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={category ? `Rename ${category.name}` : "New category"}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={saving || !name.trim()}>
            {category ? "Save" : "Add category"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" className="full" hint="For example RFIs, Claims, Letters or Site instructions. It shows next to EIs in this project.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="RFIs" maxLength={40} autoFocus />
        </Field>
        <Field label="References start with" className="full" hint="Optional, for example RFI. It's only a hint in the form.">
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="RFI" maxLength={8} />
        </Field>
      </div>
    </Sheet>
  );
}
