// A project's cover: its photo if one was added, otherwise a navy banner tinted with the
// project colour and a faint skyline. Hassan and seniors can add, change or remove it.
import { useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, Trash2 } from "lucide-react";
import { useInvalidate } from "@/lib/api";
import { removeProjectCover, setProjectCover } from "@/lib/covers";
import { errorMessage } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { Spinner, useConfirm, useToast } from "./ui";

function Skyline() {
  return (
    <svg className="cover-skyline" viewBox="0 0 320 90" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <path d="M0 90V70h18V52h14v18h10V40h20v50M70 90V24h26v66M104 90V58h16V34h22v56M150 90V12h8V4h4v8h8v78M178 90V46h24v44M210 90V30h18v-8h14v68M250 90V54h20v36M278 90V38h16v52M300 90V60h20v30" />
      <path d="M118 34V8M118 8h46M118 14l8-6M150 8v8" className="crane" />
    </svg>
  );
}

export function ProjectCover({ project, editable = false, size = "card" }: { project: Project; editable?: boolean; size?: "card" | "hero" }) {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await setProjectCover(project.id, file, project.cover_url);
      await invalidate("projects");
      toast("Cover photo updated");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    if (!(await confirm({ title: "Remove the cover photo?", message: "The project goes back to its plain banner.", confirmLabel: "Remove", danger: true }))) return;
    setBusy(true);
    try {
      await removeProjectCover(project.id, project.cover_url);
      await invalidate("projects");
      toast("Cover photo removed");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={clsx("project-cover", size, !project.cover_url && "plain")}
      style={{ ["--pc" as string]: project.color }}
    >
      {project.cover_url ? <img src={project.cover_url} alt="" loading="lazy" decoding="async" /> : <Skyline />}
      <span className="cover-shade" aria-hidden />
      <span className="cover-strip" aria-hidden />
      {editable && (
        <div className="cover-actions" onClick={(e) => e.preventDefault()}>
          <button type="button" className="btn small on-dark" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Spinner size={14} /> : <ImagePlus />} {project.cover_url ? "Change cover" : "Add cover photo"}
          </button>
          {project.cover_url && (
            <button type="button" className="btn small on-dark" onClick={onRemove} disabled={busy} aria-label="Remove cover photo">
              <Trash2 />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}
    </div>
  );
}
