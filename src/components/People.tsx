// People helpers: the WhatsApp button, the +966 mobile number box, and the profile card
// that opens when you tap someone's photo anywhere in the app.
import "@/styles/people.css";
import { useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Mail, MessageCircle, Phone, UserPen } from "lucide-react";
import { usePeople } from "@/lib/api";
import { startDirectChat } from "@/lib/chats";
import { errorMessage } from "@/lib/supabase";
import { useMe } from "@/lib/auth";
import { COUNTRY_CODE, formatPhone, localDigits, whatsappLink } from "@/lib/phone";
import type { Profile } from "@/lib/types";
import { Avatar, Pill, Sheet, useToast } from "./ui";
import { showsManagerLabel } from "@/lib/people";

/* ---------------------------------------------------------------- WhatsApp */
export function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * Opens a WhatsApp chat with this person. Hidden for yourself and for anyone without a number.
 * `text` pre-fills the message (used on tasks).
 */
export function WhatsAppButton({
  person,
  text,
  variant = "icon",
  className,
}: {
  person: Profile | null | undefined;
  text?: string;
  variant?: "icon" | "small" | "button";
  className?: string;
}) {
  const me = useMe();
  if (!person?.phone || person.id === me.id || !person.active) return null;
  const label = `WhatsApp ${person.short_name}`;
  return (
    <a
      className={clsx("wa", variant, className)}
      href={whatsappLink(person.phone, text)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
    >
      <WhatsAppIcon size={variant === "small" ? 15 : 18} />
      {variant === "button" && <span>WhatsApp</span>}
    </a>
  );
}

/* ---------------------------------------------------------------- +966 mobile number */
export function PhoneInput({
  value,
  onChange,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={clsx("phone-input", invalid && "invalid")}>
      <span className="cc" aria-hidden>
        {COUNTRY_CODE}
      </span>
      <input
        className="input"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="5X XXX XXXX"
        aria-label={`Mobile number after ${COUNTRY_CODE}`}
        value={value}
        onChange={(e) => onChange(localDigits(e.target.value))}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- profile card */
let openId: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const setOpenId = (id: string | null) => {
  openId = id;
  listeners.forEach((fn) => fn());
};

/** Show someone's profile card: photo, title, and WhatsApp, call and email buttons. */
export function openPersonCard(id: string) {
  setOpenId(id);
}

/** A person's photo that opens their profile card when tapped. */
export function PersonAvatar({ person, size = 32 }: { person: Profile | null | undefined; size?: number }) {
  if (!person) return <Avatar person={person} size={size} />;
  return (
    <button
      type="button"
      className="avatar-btn"
      onClick={(e) => {
        e.stopPropagation();
        openPersonCard(person.id);
      }}
      aria-label={`${person.full_name}'s profile`}
    >
      <Avatar person={person} size={size} />
    </button>
  );
}

/** Photo and name together, opening the profile card. */
export function PersonLink({ person, size = 22 }: { person: Profile | null | undefined; size?: number }) {
  if (!person) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <Avatar person={null} size={size} />
        <span className="faint">Unassigned</span>
      </span>
    );
  }
  return (
    <button type="button" className="person-link" onClick={() => openPersonCard(person.id)}>
      <Avatar person={person} size={size} />
      <span className="ellipsis">{person.short_name}</span>
    </button>
  );
}

/** Rendered once in the app shell. */
export function PersonCardHost() {
  const id = useSyncExternalStore(subscribe, () => openId);
  const people = usePeople();
  const me = useMe();
  const p = id ? people.get(id) : undefined;
  const close = () => setOpenId(null);
  const isMe = p?.id === me.id;
  const navigate = useNavigate();
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  async function message() {
    if (!p || opening) return;
    setOpening(true);
    try {
      const id = await startDirectChat(p.id);
      close();
      navigate(`/chats/${id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setOpening(false);
    }
  }

  return (
    <Sheet open={!!p} onClose={close} title={p ? p.short_name : ""}>
      {p && (
        <div className="person-card">
          <Avatar person={p} size={104} />
          <div className="pc-name">{p.full_name}</div>
          <div className="pc-title">
            {p.title}
            {showsManagerLabel(p) ? <Pill tone="blue">Manager</Pill> : p.role !== "manager" && p.can_assign ? <Pill tone="purple">Can assign</Pill> : null}
          </div>

          {!isMe && (
            <div className="pc-actions">
              <button className="btn primary" type="button" onClick={message} disabled={opening}>
                <MessageCircle /> Message
              </button>
              {p.phone ? (
                <>
                  <WhatsAppButton person={p} variant="button" />
                  <a className="btn" href={`tel:${p.phone}`}>
                    <Phone /> Call
                  </a>
                </>
              ) : null}
              <a className="btn" href={`mailto:${p.email}`}>
                <Mail /> Email
              </a>
            </div>
          )}

          <div className="pc-details solid">
            <div>
              <span>Mobile</span>
              <b className="num">{p.phone ? formatPhone(p.phone) : <span className="faint">Not added yet</span>}</b>
            </div>
            <div>
              <span>Email</span>
              <b className="ellipsis">{p.email}</b>
            </div>
          </div>

          {isMe && (
            <Link className="btn" to="/settings/profile" onClick={close}>
              <UserPen /> Edit your profile
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}
