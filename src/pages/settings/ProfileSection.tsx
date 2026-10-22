import { useEffect, useState } from "react";
import { useAuth, useMe } from "@/lib/auth";
import { useInvalidate } from "@/lib/api";
import { errorMessage, supabase } from "@/lib/supabase";
import { Avatar, Field, Pill, useToast } from "@/components/ui";
import { Section } from "./common";

export function ProfileSection() {
  const me = useMe();
  const { isManager, canAssign, refreshProfile } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [fullName, setFullName] = useState(me.full_name);
  const [shortName, setShortName] = useState(me.short_name);
  const [title, setTitle] = useState(me.title);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(me.full_name);
    setShortName(me.short_name);
    setTitle(me.title);
    setPhone(me.phone ?? "");
  }, [me.full_name, me.short_name, me.title, me.phone]);

  const dirty = fullName !== me.full_name || shortName !== me.short_name || phone !== (me.phone ?? "") || (isManager && title !== me.title);

  async function save() {
    if (!fullName.trim() || !shortName.trim()) {
      toast("Name can't be empty", "error");
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { full_name: fullName.trim(), short_name: shortName.trim(), phone: phone.trim() || null };
      if (isManager) patch.title = title.trim() || me.title;
      const { error } = await supabase.from("profiles").update(patch).eq("id", me.id);
      if (error) throw error;
      await refreshProfile();
      await invalidate("profiles");
      toast("Profile saved");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Profile" sub="How you appear to the team in tasks, chat and @mentions.">
      <div className="row" style={{ gap: 14 }}>
        <Avatar person={{ ...me, full_name: fullName || me.full_name, short_name: shortName || me.short_name }} size={64} />
        <div style={{ minWidth: 0 }}>
          <div className="bold" style={{ fontSize: 18 }}>
            {fullName || me.full_name}
          </div>
          <div className="muted small">{me.title}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {isManager ? <Pill tone="blue">Manager</Pill> : canAssign ? <Pill tone="purple">Can assign tasks</Pill> : <Pill>Team member</Pill>}
          </div>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Full name">
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Short name" hint={`Used for @mentions, e.g. @${shortName || "Saheeb"}`}>
          <input className="input" value={shortName} onChange={(e) => setShortName(e.target.value.replace(/\s+/g, ""))} />
        </Field>
        <Field label="Job title" hint={isManager ? undefined : "Only Hassan can change job titles"}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!isManager} />
        </Field>
        <Field label="Mobile number">
          <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5x xxx xxxx" autoComplete="tel" />
        </Field>
        <Field label="Work email" className="full" hint={isManager ? "This is the email you sign in with" : "Ask Hassan if this needs to change"}>
          <input className="input" value={me.email} disabled />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={save} disabled={!dirty || saving} type="button">
          {saving ? "Saving..." : "Save profile"}
        </button>
      </div>
    </Section>
  );
}
