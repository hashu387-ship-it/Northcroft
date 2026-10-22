import { useEffect, useMemo, useState } from "react";
import { Building2, HardHat, LocateFixed, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useInvalidate, useProjectMap, useProjects } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getPosition, reverseGeocode } from "@/lib/geo";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Place, PlaceKind } from "@/lib/types";
import { Empty, Field, Loading, Pill, ProjectSelect, Segmented, Sheet, useConfirm, useToast } from "@/components/ui";
import { MapBox, usePlaces } from "../attendance/shared";
import { Section } from "./common";

export function PlacesSection() {
  const { isManager } = useAuth();
  const places = usePlaces();
  const projects = useProjectMap();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Place | "new" | null>(null);

  const list = places.data ?? [];
  const points = useMemo(
    () => list.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, color: p.kind === "office" ? "#30D158" : "#0A84FF", radius: p.radius_m })),
    [list],
  );

  async function remove(p: Place) {
    if (!(await confirm({ title: `Delete ${p.name}?`, message: "Past check-ins keep their place name. New check-ins here will show as Elsewhere.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.from("places").delete().eq("id", p.id);
    if (error) toast(errorMessage(error), "error");
    else {
      toast("Place deleted");
      invalidate("places");
    }
  }

  return (
    <Section
      title="Office and sites"
      sub="Check-ins within a place's radius are labelled with its name. Anywhere else shows as Elsewhere, in amber."
      actions={
        isManager ? (
          <button className="btn small primary" onClick={() => setEditing("new")} type="button">
            <Plus /> Add place
          </button>
        ) : undefined
      }
    >
      {places.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={<MapPin />} title="No places yet">
          {isManager ? "Add the office first, then each project site." : "Hassan hasn't added any places yet."}
        </Empty>
      ) : (
        <>
          {!list.some((p) => p.kind === "office") && isManager && (
            <div className="banner solid">
              <Building2 />
              <div className="grow small">
                <b>The office isn't added yet</b>
                <div className="muted">Stand in the office, tap Add place, then Use my current location.</div>
              </div>
            </div>
          )}
          <MapBox points={points} className="map" />
          <div className="list">
            {list.map((p) => (
              <div className="list-item" key={p.id}>
                <span className="settings-icon" style={{ background: p.kind === "office" ? "var(--green)" : "var(--accent)" }}>
                  {p.kind === "office" ? <Building2 /> : <HardHat />}
                </span>
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="meta">
                    <Pill tone={p.kind === "office" ? "green" : "blue"}>{p.kind === "office" ? "Office" : "Site"}</Pill>
                    <span>{p.radius_m} m radius</span>
                    {p.project_id && <span>{projects.get(p.project_id)?.name}</span>}
                    {p.address && <span className="faint">{p.address}</span>}
                  </div>
                </div>
                {isManager && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn small plain" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} type="button">
                      <Pencil />
                    </button>
                    <button className="icon-btn small plain" onClick={() => remove(p)} aria-label={`Delete ${p.name}`} type="button">
                      <Trash2 />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {isManager && <PlaceEditor place={editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function PlaceEditor({ place, onClose }: { place: Place | "new" | null; onClose: () => void }) {
  const { data: projects = [] } = useProjects();
  const toast = useToast();
  const invalidate = useInvalidate();
  const open = place !== null;
  const existing = place && place !== "new" ? place : null;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlaceKind>("office");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [radius, setRadius] = useState(200);
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setKind(existing?.kind ?? "office");
    setProjectId(existing?.project_id ?? null);
    setLat(existing?.lat ?? null);
    setLng(existing?.lng ?? null);
    setRadius(existing?.radius_m ?? 200);
    setAddress(existing?.address ?? "");
  }, [open, existing]);

  async function pick(la: number, ln: number) {
    setLat(la);
    setLng(ln);
    const a = await reverseGeocode(la, ln);
    if (a) setAddress(a);
  }

  async function useMyLocation() {
    setLocating(true);
    try {
      const fix = await getPosition();
      await pick(fix.lat, fix.lng);
      toast(`Location found, accurate to about ${fix.accuracy} m`, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLocating(false);
    }
  }

  const points = useMemo(
    () => (lat != null && lng != null ? [{ id: "edit", lat, lng, label: name || "New place", color: kind === "office" ? "#30D158" : "#0A84FF", radius }] : []),
    [lat, lng, name, kind, radius],
  );

  async function save() {
    if (!name.trim()) return toast("Give the place a name", "error");
    if (lat == null || lng == null) return toast("Tap the map or use your location to set the spot", "error");
    setSaving(true);
    try {
      const row = { name: name.trim(), kind, project_id: kind === "site" ? projectId : null, lat, lng, radius_m: radius, address: address.trim() || null };
      const { error } = existing ? await supabase.from("places").update(row).eq("id", existing.id) : await supabase.from("places").insert(row);
      if (error) throw error;
      await invalidate("places");
      toast(existing ? "Place updated" : "Place added");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a place"}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving} type="button">
            {saving ? "Saving..." : existing ? "Save changes" : "Add place"}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="row wrap">
          <Segmented<PlaceKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "office", label: "Office" },
              { value: "site", label: "Project site" },
            ]}
          />
          <span className="spacer" />
          <button className="btn small" onClick={useMyLocation} disabled={locating} type="button">
            <LocateFixed /> {locating ? "Finding you..." : "Use my current location"}
          </button>
        </div>
        <MapBox points={points} className="map" onPick={pick} />
        <div className="muted tiny">Tap the map to drop the pin exactly where the entrance is.</div>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "office" ? "Northcroft office" : "e.g. Olaya Tower site"} />
          </Field>
          {kind === "site" ? (
            <Field label="Project">
              <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} emptyLabel="No project" />
            </Field>
          ) : (
            <div />
          )}
          <Field label={`Radius: ${radius} m`} className="full" hint="Check-ins within this distance count as being here">
            <input className="range" type="range" min={50} max={1000} step={25} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          </Field>
          <Field label="Address" className="full">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Filled in from the map" />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
