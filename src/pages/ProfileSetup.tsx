import { useRef, useState, type FormEvent } from "react";
import { Camera, CircleCheck, Circle, ImagePlus, ArrowRight } from "lucide-react";
import { setProfilePhoto } from "@/lib/avatar";
import { useAuth, useMe } from "@/lib/auth";
import { useInvalidate } from "@/lib/api";
import { localDigits, normalizeSaudiMobile } from "@/lib/phone";
import { errorMessage, supabase } from "@/lib/supabase";
import { PhotoBackground } from "@/layout/AppShell";
import { LogoMark } from "@/components/Brand";
import { PhoneInput } from "@/components/People";
import { Avatar, Spinner, useToast } from "@/components/ui";

/**
 * Shown after sign-in until the person has a profile photo and a +966 mobile number.
 * The photo appears on tasks, chats and notifications; the number powers the WhatsApp buttons.
 */
export default function ProfileSetup() {
  const me = useMe();
  const { refreshProfile, signOut } = useAuth();
  const invalidate = useInvalidate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(() => (me.phone ? localDigits(me.phone) : ""));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hasPhoto = !!me.avatar_url;
  const normalized = normalizeSaudiMobile(phone);
  const phoneDone = !!normalized;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      await setProfilePhoto(me.id, file, me.avatar_url);
      await refreshProfile();
      await invalidate("profiles");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!hasPhoto) return setError("Add a photo so the team can recognise you.");
    if (!normalized) return setError("Enter your Saudi mobile number. It starts with 5 and has 9 digits, for example 50 123 4567.");
    setSaving(true);
    try {
      const { error: err } = await supabase.from("profiles").update({ phone: normalized }).eq("id", me.id);
      if (err) throw err;
      await invalidate("profiles");
      await refreshProfile();
      toast("You're all set");
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <PhotoBackground>
      <div className="auth-wrap">
        <form className="auth-card glass-strong" onSubmit={submit}>
          <div className="auth-brand">
            <LogoMark variant="tile" size={56} className="logo-tile" />
          </div>
          <h1>Finish your profile, {me.short_name}</h1>
          <p className="lead">Your photo shows on tasks, chats and notifications. Your mobile lets the team reach you on WhatsApp.</p>

          <div className="setup-steps" aria-hidden>
            <span className={hasPhoto ? "done" : ""}>
              {hasPhoto ? <CircleCheck /> : <Circle />} Photo
            </span>
            <span className={phoneDone ? "done" : ""}>
              {phoneDone ? <CircleCheck /> : <Circle />} Mobile number
            </span>
          </div>

          <button
            type="button"
            className={`setup-photo${hasPhoto ? " has-photo" : ""}`}
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            aria-label={hasPhoto ? "Change your photo" : "Add your photo"}
          >
            {hasPhoto ? (
              <Avatar person={me} size={112} />
            ) : (
              <span className="empty-face">
                <ImagePlus />
                Add photo
              </span>
            )}
            <span className="photo-badge">{photoBusy ? <Spinner size={16} /> : <Camera size={16} />}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          <p className="muted small" style={{ textAlign: "center", margin: "0 0 18px" }}>
            {hasPhoto ? "Looks good. Tap it to choose a different one." : "Take a selfie or pick one from your gallery."}
          </p>

          <label className="field">
            <span>Mobile number</span>
            <PhoneInput value={phone} onChange={setPhone} invalid={!!error && !phoneDone && phone.length > 0} />
          </label>

          {error && (
            <div className="pill red lg" role="alert" style={{ height: "auto", padding: "8px 12px", whiteSpace: "normal", marginTop: 12 }}>
              {error}
            </div>
          )}

          <button className="btn primary large block" style={{ marginTop: 16 }} disabled={saving || photoBusy} type="submit">
            {saving ? "Saving..." : "Continue"} {!saving && <ArrowRight />}
          </button>
          <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => signOut()} type="button">
            Sign out
          </button>
        </form>
      </div>
    </PhotoBackground>
  );
}
