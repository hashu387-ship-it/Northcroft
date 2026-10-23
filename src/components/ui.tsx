import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown, ChevronsUp, ChevronUp, CircleAlert, CircleCheck, Clock, Info, Minus, Sparkles, X } from "lucide-react";
import { daysText, earlyDays } from "@/lib/celebrate";
import { initials } from "@/lib/format";
import { dueState, fmtDue } from "@/lib/time";
import { PRIORITY, PRIORITY_ORDER, TASK_STATUS } from "@/lib/constants";
import type { Priority, Profile, Project, Task, TaskStatus } from "@/lib/types";
import { artForIcon, Illustration, type ArtName } from "./Illustrations";

/* ---------------------------------------------------------------- avatar */
export function Avatar({
  person,
  size = 32,
  title,
}: {
  person?: (Pick<Profile, "short_name" | "full_name" | "color"> & { avatar_url?: string | null }) | null;
  size?: number;
  title?: string;
}) {
  const [broken, setBroken] = useState(false);
  const photo = person?.avatar_url && !broken ? person.avatar_url : null;
  if (photo) {
    return (
      <img
        className="avatar photo"
        src={photo}
        alt={person!.full_name}
        title={title ?? person!.full_name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        style={{ ["--size" as string]: `${size}px` }}
      />
    );
  }
  if (!person) {
    return (
      <span className="avatar" style={{ ["--size" as string]: `${size}px`, background: "var(--fill-2)", color: "var(--text-2)" }} title={title ?? "Unassigned"}>
        ?
      </span>
    );
  }
  return (
    <span
      className="avatar"
      style={{ ["--size" as string]: `${size}px`, background: `linear-gradient(145deg, ${person.color}, color-mix(in srgb, ${person.color} 70%, #000))` }}
      title={title ?? person.full_name}
      aria-label={person.full_name}
    >
      {initials(person.full_name === person.short_name ? person.short_name : person.full_name)}
    </span>
  );
}

export function AvatarStack({ people, size = 26, max = 5 }: { people: (Profile | undefined)[]; size?: number; max?: number }) {
  const list = people.filter(Boolean) as Profile[];
  const shown = list.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {list.length > max && (
        <span className="avatar" style={{ ["--size" as string]: `${size}px`, background: "var(--fill-2)", color: "var(--text)" }}>
          +{list.length - max}
        </span>
      )}
    </span>
  );
}

export function PersonChip({ person, size = 22 }: { person?: Profile | null; size?: number }) {
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <Avatar person={person} size={size} />
      <span className="ellipsis">{person?.short_name ?? "Unassigned"}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- pills */
export function Pill({ tone = "gray", children, className, lg }: { tone?: string; children: ReactNode; className?: string; lg?: boolean }) {
  return <span className={clsx("pill", tone, lg && "lg", className)}>{children}</span>;
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function StatusRing({ status }: { status: TaskStatus }) {
  // Play a short tick animation only when a task changes to done while you're looking at it.
  const prev = useRef(status);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (status === "done" && prev.current !== "done") {
      setJustDone(true);
      const t = window.setTimeout(() => setJustDone(false), 900);
      prev.current = status;
      return () => window.clearTimeout(t);
    }
    prev.current = status;
  }, [status]);
  return (
    <span className={clsx("status-ring", status, justDone && "just-done")} aria-label={TASK_STATUS[status].label}>
      {status === "done" && <Check strokeWidth={3} />}
      {status === "in_review" && <Clock strokeWidth={2.6} />}
    </span>
  );
}

/** A number that counts up from zero when it first appears (or jumps straight there with reduced motion). */
export function CountUp({ value, duration = 650 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === from.current) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="count-up">{shown}</span>;
}

const PRIORITY_ICON: Record<Priority, typeof ChevronUp> = { urgent: ChevronsUp, high: ChevronUp, normal: Minus, low: ChevronDown };

/** Glossy priority badge: Urgent deep red with a glow, High red, Normal yellow, Low green. Shown on every item. */
export function PriorityFlag({ priority, size }: { priority: Priority; size?: "small" }) {
  const Icon = PRIORITY_ICON[priority] ?? Minus;
  const label = PRIORITY[priority]?.label ?? "Normal";
  return (
    <span className={clsx("prio", priority, size)} title={`${label} priority`}>
      <Icon strokeWidth={3} aria-hidden />
      {label}
    </span>
  );
}

/** Gold-on-navy "Finished early" badge for work handed in before its due date. */
export function EarlyBadge({ task, size }: { task: Pick<Task, "status" | "submitted_at" | "due_date">; size?: "small" }) {
  const n = earlyDays(task);
  if (!n || (task.status !== "in_review" && task.status !== "done")) return null;
  return (
    <span className={clsx("early-badge", size)} title={`Handed in ${daysText(n)} before the due date`}>
      <Sparkles aria-hidden />
      Finished early
    </span>
  );
}

/** Four glossy buttons to pick a priority, used in the task, VO and BOQ package forms. */
export function PriorityPicker({ value, onChange, disabled }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean }) {
  return (
    <div className="prio-picker" role="radiogroup" aria-label="Priority">
      {PRIORITY_ORDER.map((p) => {
        const Icon = PRIORITY_ICON[p];
        const on = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            className={clsx("prio", p, !on && "off")}
            onClick={() => onChange(p)}
            disabled={disabled}
          >
            <Icon strokeWidth={3} aria-hidden />
            {PRIORITY[p].label}
          </button>
        );
      })}
    </div>
  );
}

export function DueLabel({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const state = dueState(date, done);
  return (
    <span className={clsx("due", state === "overdue" && "overdue", state === "today" && "today")}>
      <Clock />
      {fmtDue(date)}
    </span>
  );
}

export function ProjectTag({ project }: { project?: Project | null }) {
  if (!project) return <span className="faint">General</span>;
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <i className="dot-swatch" style={{ background: project.color }} />
      <span className="ellipsis">{project.name}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- misc */
export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

/** Shimmering placeholder rows while something loads. */
export function Loading({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <span className="skeleton sk-dot" />
          <span className="sk-lines">
            <span className="skeleton" style={{ width: `${78 - i * 14}%` }} />
            <span className="skeleton" style={{ width: `${48 - i * 9}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Empty screens show a small navy and red drawing picked from the icon (or `art`). */
export function Empty({
  icon,
  art,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  art?: ArtName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const picture = art ?? artForIcon(icon);
  return (
    <div className="empty">
      {picture ? <Illustration name={picture} /> : icon}
      <b>{title}</b>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={clsx(o.value === value && "active")} onClick={() => onChange(o.value)} type="button">
          {o.label}
          {o.count !== undefined && <span className="n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled form field. Use `group` when it holds several buttons (people chips, the priority picker):
 * a plain label would pass a tap on its text to the first button inside it.
 */
export function Field({ label, children, className, hint, group }: { label: string; children: ReactNode; className?: string; hint?: ReactNode; group?: boolean }) {
  const id = useId();
  if (group) {
    return (
      <div className={clsx("field", className)} role="group" aria-labelledby={id}>
        <span id={id}>{label}</span>
        {children}
        {hint && <small className="muted tiny">{hint}</small>}
      </div>
    );
  }
  return (
    <label className={clsx("field", className)}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted tiny">{hint}</small>}
    </label>
  );
}

export function PersonSelect({
  value,
  onChange,
  people,
  placeholder = "Unassigned",
  allowEmpty = true,
  ...rest
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  people: Profile[];
  placeholder?: string;
  allowEmpty?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.short_name}
          {p.title ? ` · ${p.title}` : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * Pick one or more people: the chosen ones show as chips (tap the cross to take someone off),
 * and a list underneath adds more.
 */
export function PeopleSelect({
  value,
  onChange,
  people,
  empty = "Nobody yet",
  disabled,
  label = "Add a person",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  people: Profile[];
  empty?: string;
  disabled?: boolean;
  label?: string;
}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const rest = people.filter((p) => !value.includes(p.id));
  return (
    <div className="people-select">
      <div className="people-chips">
        {value.length === 0 && <span className="faint small">{empty}</span>}
        {value.map((id) => {
          const p = byId.get(id);
          return (
            <span className="person-chip" key={id}>
              <Avatar person={p} size={22} />
              <span className="ellipsis">{p?.short_name ?? "Former team member"}</span>
              {!disabled && (
                <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Take ${p?.short_name ?? "them"} off`}>
                  <X size={13} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!disabled && rest.length > 0 && (
        <select
          className="select"
          value=""
          aria-label={label}
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
        >
          <option value="">{value.length ? "Add another person" : label}</option>
          {rest.map((p) => (
            <option key={p.id} value={p.id}>
              {p.short_name}
              {p.title ? ` · ${p.title}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ProjectSelect({
  value,
  onChange,
  projects,
  allowEmpty = true,
  emptyLabel = "General (no project)",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  projects: Project[];
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {projects
        .filter((p) => p.status !== "completed" || p.id === value)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.code ? `${p.code} · ` : ""}
            {p.name}
          </option>
        ))}
    </select>
  );
}

/* ---------------------------------------------------------------- sheet (modal) */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx("sheet glass-strong", wide && "wide")} role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close" type="button">
            <X />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- toasts */
type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: ToastKind = "success") => {
    const id = ++idRef.current;
    setItems((xs) => [...xs.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), kind === "error" ? 5200 : 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={clsx("toast glass-strong", t.kind)}>
              {t.kind === "success" ? <CircleCheck /> : t.kind === "error" ? <CircleAlert /> : <Info />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------------------------------------------------------------- confirm */
interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Sheet
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        footer={
          <>
            <button className="btn" onClick={() => close(false)} type="button">
              Cancel
            </button>
            <button className={clsx("btn", state?.danger ? "danger" : "primary")} onClick={() => close(true)} type="button">
              {state?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        <div className="muted">{state?.message}</div>
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
