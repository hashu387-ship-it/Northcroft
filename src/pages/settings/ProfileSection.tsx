import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { setProfilePhoto } from "@/lib/avatar";
import { useAuth, useMe } from "@/lib/auth";
import { useInvalidate } from "@/lib/api";
import { localDigits, normalizeSaudiMobile } from "@/lib/phone";
import { errorMessage, supabase } from "@/lib/supabase";
import { PhoneInput } from "@/components/People";
import { Avatar, Field, Pill, Spinner, useToast } from "@/components/ui";
import { Section } from "./common";
import { showsManagerLabel } from "@/lib/people";

export function ProfileSection() {
  const me = useMe();
  const { isManager, canAssign, refreshProfile } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [fullName, setFullName] = useState(me.full_name);
  const [shortName, setShortName] = useState(me.short_name);
  const [title, setTitle] = useState(me.title);
  const [phone, setPhone] = useState(me.phone ? localDigits(me.phone) : "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      await setProfilePhoto(me.id, file, me.avatar_url);
      await refreshProfile();
      await invalidate("profiles");
      toast("Photo updated");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    setFullName(me.full_name);
    setShortName(me.short_name);
    setTitle(me.title);
    setPhone(me.phone ? localDigits(me.phone) : "");
  }, [me.full_name, me.short_name, me.title, me.phone]);

  const normalized = normalizeSaudiMobile(phone);
  const dirty = fullName !== me.full_name || shortName !== me.short_name || normalized !== me.phone || (isManager && title !== me.title);

  async function save() {
    if (!fullName.trim() || !shortName.trim()) {
      toast("Name can't be empty", "error");
      return;
    }
    if (!normalized) {
      toast("Enter your Saudi mobile number: 9 digits starting with 5", "error");
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { full_name: fullName.trim(), short_name: shortName.trim(), phone: normalized };
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
      <div className="row" style={{ gap: 16, alignItems: "center" }}>
        <button
          type="button"
          className="photo-picker"
          onClick={() => fileRef.current?.click()}
          disabled={photoBusy}
          aria-label={me.avatar_url ? "Change your photo" : "Add a photo"}
        >
          <Avatar person={{ ...me, full_name: fullName || me.full_name, short_name: shortName || me.short_name }} size={84} />
          <span className="photo-badge">{photoBusy ? <Spinner size={16} /> : <Camera size={16} />}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        <div style={{ minWidth: 0 }}>
          <div className="bold" style={{ fontSize: 16 }}>
            {fullName || me.full_name}
          </div>
          <div className="muted small">{me.title}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {isManager ? <Pill tone="blue">{showsManagerLabel(me) ? "Manager" : me.title}</Pill> : canAssign ? <Pill tone="purple">Can assign tasks</Pill> : <Pill>Team member</Pill>}
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn small" type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
              <Camera /> {me.avatar_url ? "Change photo" : "Add a photo"}
            </button>
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
        <Field label="Mobile number" hint="The team uses this to reach you on WhatsApp">
          <PhoneInput value={phone} onChange={setPhone} invalid={phone.length > 0 && !normalized} />
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
