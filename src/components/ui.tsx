import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, CircleAlert, CircleCheck, Clock, Flag, Info, X } from "lucide-react";
import { initials } from "@/lib/format";
import { dueState, fmtDue } from "@/lib/time";
import { PRIORITY, TASK_STATUS } from "@/lib/constants";
import type { Priority, Profile, Project, TaskStatus } from "@/lib/types";

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
  return (
    <span className={clsx("status-ring", status)} aria-label={TASK_STATUS[status].label}>
      {status === "done" && <Check strokeWidth={3} />}
      {status === "in_review" && <Clock strokeWidth={2.6} />}
    </span>
  );
}

export function PriorityFlag({ priority, showNormal = false }: { priority: Priority; showNormal?: boolean }) {
  if (priority === "normal" && !showNormal) return null;
  return (
    <span className={clsx("prio", priority)}>
      <Flag fill="currentColor" />
      {PRIORITY[priority].label}
    </span>
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

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner />
      <span className="small">{label}</span>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
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

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: ReactNode }) {
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
