import { useEffect, useState } from "react";
import { ChevronRight, Copy, KeyRound, RefreshCw, ShieldCheck, UserPlus, UserX, UserCheck } from "lucide-react";
import { useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { randomPassword } from "@/lib/format";
import { formatPhone, localDigits, normalizeSaudiMobile } from "@/lib/phone";
import type { Profile } from "@/lib/types";
import { PhoneInput, WhatsAppButton, openPersonCard } from "@/components/People";
import { Avatar, Field, Pill, Sheet, Switch, useConfirm, useToast } from "@/components/ui";
import { Section, adminCall, copyText } from "./common";

function RoleBadge({ p }: { p: Profile }) {
  if (!p.active) return <Pill tone="red">Access off</Pill>;
  if (p.role === "manager") return <Pill tone="blue">Manager</Pill>;
  if (p.can_assign) return <Pill tone="purple">Can assign</Pill>;
  return <Pill>Member</Pill>;
}

function Credentials({ name, email, password }: { name: string; email: string; password: string }) {
  const toast = useToast();
  const text = `Northcroft sign-in for ${name}\nLink: ${window.location.origin}\nEmail: ${email}\nTemporary password: ${password}\nYou'll be asked to choose your own password when you first sign in.`;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="cred-box">
        <span className="muted small" style={{ width: 70 }}>
          Email
        </span>
        <code>{email}</code>
      </div>
      <div className="cred-box">
        <span className="muted small" style={{ width: 70 }}>
          Password
        </span>
        <code>{password}</code>
      </div>
      <button
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={async () => toast((await copyText(text)) ? "Copied. Paste it into WhatsApp or email." : "Couldn't copy. Select the text instead.", "info")}
        type="button"
      >
        <Copy /> Copy sign-in details
      </button>
      <div className="muted small">They'll be asked to choose their own password the first time they sign in. Share this privately.</div>
    </div>
  );
}

export function TeamSection() {
  const me = useMe();
  const { isManager } = useAuth();
  const people = usePeople();
  const [manage, setManage] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);

  const list = [...people.all].sort((a, b) =>
    a.active !== b.active ? (a.active ? -1 : 1) : a.role !== b.role ? (a.role === "manager" ? -1 : 1) : a.short_name.localeCompare(b.short_name),
  );
  const current = manage ? people.get(manage.id) ?? manage : null;

  return (
    <Section
      title="Team"
      sub={isManager ? "Choose who can assign work, reset passwords and add new people." : "Everyone on the Northcroft QS team."}
      actions={
        isManager ? (
          <button className="btn small primary" onClick={() => setAdding(true)} type="button">
            <UserPlus /> Add person
          </button>
        ) : undefined
      }
    >
      <div className="list">
        {list.map((p) => (
          <div key={p.id} className="list-item">
            {/* Managers open the manage panel; everyone else sees the person's profile card. */}
            <button className="list-main" onClick={() => (isManager ? setManage(p) : openPersonCard(p.id))} type="button">
              <Avatar person={p} size={40} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title" style={{ opacity: p.active ? 1 : 0.55 }}>
                  {p.full_name}
                  {p.id === me.id && <span className="faint small"> (you)</span>}
                </div>
                <div className="meta">
                  <span>{p.title}</span>
                  {p.phone ? <span className="num">{formatPhone(p.phone)}</span> : <span className="faint">No mobile yet</span>}
                  <span className="faint ellipsis hide-mobile">{p.email}</span>
                </div>
              </div>
              <RoleBadge p={p} />
            </button>
            <WhatsAppButton person={p} />
            {isManager && <ChevronRight size={18} className="faint hide-mobile" />}
          </div>
        ))}
      </div>
      {isManager && current && <ManagePerson person={current} onClose={() => setManage(null)} />}
      {isManager && <AddPerson open={adding} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function ManagePerson({ person, onClose }: { person: Profile; onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(person.title);
  const [phone, setPhone] = useState(person.phone ? localDigits(person.phone) : "");
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState(randomPassword());
  const [newCreds, setNewCreds] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSelf = person.id === me.id;
  const isManagerRow = person.role === "manager";

  useEffect(() => setTitle(person.title), [person.title]);
  useEffect(() => setPhone(person.phone ? localDigits(person.phone) : ""), [person.phone]);
  const normalizedPhone = normalizeSaudiMobile(phone);

  async function update(patch: Partial<Profile>, msg: string) {
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update(patch).eq("id", person.id);
      if (error) throw error;
      await invalidate("profiles");
      toast(msg);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (password.length < 8) {
      toast("Use at least 8 characters", "error");
      return;
    }
    if (!(await confirm({ title: `Reset ${person.short_name}'s password?`, message: "Their current password stops working straight away.", confirmLabel: "Reset password" }))) return;
    setBusy(true);
    try {
      await adminCall({ action: "reset_password", user_id: person.id, password });
      setNewCreds(password);
      setResetOpen(false);
      await invalidate("profiles");
      toast("Password reset");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(active: boolean) {
    const ok = await confirm(
      active
        ? { title: `Restore ${person.short_name}'s access?`, message: "They'll be able to sign in again with their password.", confirmLabel: "Restore access" }
        : {
            title: `Switch off ${person.short_name}'s access?`,
            message: "They're signed out everywhere and can't sign in. Their tasks and history stay in place. You can restore access later.",
            confirmLabel: "Switch off access",
            danger: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await adminCall({ action: "set_active", user_id: person.id, active });
      await invalidate("profiles");
      toast(active ? "Access restored" : "Access switched off");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={person.full_name}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row">
          <Avatar person={person} size={56} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">{person.full_name}</div>
            <div className="muted small ellipsis">{person.email}</div>
            <div style={{ marginTop: 6 }}>
              <RoleBadge p={person} />
            </div>
          </div>
        </div>

        <div className="solid stack" style={{ padding: "4px 16px", gap: 0, borderRadius: 10 }}>
          <div className="setting-row">
            <div className="grow">
              <b>Can assign tasks</b>
              <small>
                {isManagerRow
                  ? "Managers can always assign tasks, post announcements and review work."
                  : "Lets them create and assign tasks, review work, post announcements and see the team's attendance."}
              </small>
            </div>
            <Switch
              checked={isManagerRow || person.can_assign}
              disabled={isManagerRow || busy || !person.active}
              onChange={(v) => update({ can_assign: v }, v ? `${person.short_name} can now assign tasks` : `${person.short_name} can no longer assign tasks`)}
              label="Can assign tasks"
            />
          </div>
          <div className="setting-row" style={{ flexWrap: "wrap" }}>
            <Field label="Job title" className="grow">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <button
              className="btn small"
              disabled={busy || !title.trim() || title === person.title}
              onClick={() => update({ title: title.trim() }, "Title updated")}
              type="button"
              style={{ alignSelf: "flex-end", marginBottom: 4 }}
            >
              Save title
            </button>
          </div>
          <div className="setting-row" style={{ flexWrap: "wrap" }}>
            <Field label="Mobile number" className="grow">
              <PhoneInput value={phone} onChange={setPhone} invalid={phone.length > 0 && !normalizedPhone} />
            </Field>
            <button
              className="btn small"
              disabled={busy || !normalizedPhone || normalizedPhone === person.phone}
              onClick={() => update({ phone: normalizedPhone }, "Mobile number updated")}
              type="button"
              style={{ alignSelf: "flex-end", marginBottom: 4 }}
            >
              Save number
            </button>
          </div>
        </div>

        {!isSelf && person.phone && (
          <div className="row wrap" style={{ gap: 8 }}>
            <WhatsAppButton person={person} variant="button" />
            <a className="btn" href={`tel:${person.phone}`}>
              Call {person.short_name}
            </a>
          </div>
        )}

        {!isSelf && (
          <div className="stack" style={{ gap: 10 }}>
            <b>Password</b>
            {newCreds ? (
              <Credentials name={person.short_name} email={person.email} password={newCreds} />
            ) : resetOpen ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="row">
                  <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New temporary password" style={{ fontFamily: "ui-monospace, Menlo, monospace" }} />
                  <button className="icon-btn" onClick={() => setPassword(randomPassword())} aria-label="Make a new password" type="button">
                    <RefreshCw />
                  </button>
                </div>
                <div className="row wrap">
                  <button className="btn primary small" onClick={resetPassword} disabled={busy} type="button">
                    <KeyRound /> Set this password
                  </button>
                  <button className="btn small" onClick={() => setResetOpen(false)} type="button">
                    Cancel
                  </button>
                </div>
                <div className="muted small">{person.short_name} will be asked to change it when they next sign in.</div>
              </div>
            ) : (
              <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setResetOpen(true)} type="button">
                <KeyRound /> Reset password
              </button>
            )}
          </div>
        )}

        {!isSelf && !isManagerRow && (
          <div className="stack" style={{ gap: 10 }}>
            <b>Access</b>
            {person.active ? (
              <button className="btn danger" style={{ alignSelf: "flex-start" }} onClick={() => setActive(false)} disabled={busy} type="button">
                <UserX /> Switch off access
              </button>
            ) : (
              <button className="btn success" style={{ alignSelf: "flex-start" }} onClick={() => setActive(true)} disabled={busy} type="button">
                <UserCheck /> Restore access
              </button>
            )}
          </div>
        )}
        {isSelf && (
          <div className="row muted small">
            <ShieldCheck size={18} /> This is you. Change your own password in Settings, then Password.
          </div>
        )}
      </div>
    </Sheet>
  );
}

function AddPerson({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [fullName, setFullName] = useState("");
  const [shortName, setShortName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("Quantity Surveyor");
  const [canAssign, setCanAssign] = useState(false);
  const [password, setPassword] = useState(randomPassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName("");
    setShortName("");
    setEmail("");
    setTitle("Quantity Surveyor");
    setCanAssign(false);
    setPassword(randomPassword());
    setDone(null);
  }, [open]);

  async function create() {
    const e = email.trim().toLowerCase();
    if (!fullName.trim()) return toast("Enter their full name", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast("Enter a valid work email", "error");
    if (password.length < 8) return toast("The password needs at least 8 characters", "error");
    setBusy(true);
    try {
      await adminCall({
        action: "create_user",
        email: e,
        full_name: fullName.trim(),
        short_name: (shortName.trim() || fullName.trim().split(/\s+/)[0]).replace(/\s+/g, ""),
        title: title.trim() || "Quantity Surveyor",
        can_assign: canAssign,
        password,
      });
      await invalidate("profiles");
      setDone({ name: shortName.trim() || fullName.trim().split(/\s+/)[0], email: e, password });
      toast(`${fullName.trim()} added to the team`);
    } catch (err) {
      const msg = errorMessage(err);
      toast(/already been registered|already exists/i.test(msg) ? "Someone with that email already has an account." : msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={done ? "Person added" : "Add a team member"}
      footer={
        done ? (
          <button className="btn primary" onClick={onClose} type="button">
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="btn primary" onClick={create} disabled={busy} type="button">
              <UserPlus /> {busy ? "Adding..." : "Add person"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="stack" style={{ gap: 14 }}>
          <p>
            <b>{done.name}</b> can sign in now. Send them these details:
          </p>
          <Credentials name={done.name} email={done.email} password={done.password} />
        </div>
      ) : (
        <div className="form-grid">
          <Field label="Full name">
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Mohamed Rimash" autoFocus />
          </Field>
          <Field label="Short name" hint="Used for @mentions">
            <input className="input" value={shortName} onChange={(e) => setShortName(e.target.value.replace(/\s+/g, ""))} placeholder="e.g. Rimash" />
          </Field>
          <Field label="Work email" className="full">
            <input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@northcroftme.com" />
          </Field>
          <Field label="Job title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Temporary password">
            <div className="row">
              <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} style={{ fontFamily: "ui-monospace, Menlo, monospace" }} />
              <button className="icon-btn" onClick={() => setPassword(randomPassword())} aria-label="Make a new password" type="button">
                <RefreshCw />
              </button>
            </div>
          </Field>
          <div className="full setting-row" style={{ borderBottom: 0 }}>
            <div className="grow">
              <b>Can assign tasks</b>
              <small>You can change this any time.</small>
            </div>
            <Switch checked={canAssign} onChange={setCanAssign} label="Can assign tasks" />
          </div>
        </div>
      )}
    </Sheet>
  );
}
