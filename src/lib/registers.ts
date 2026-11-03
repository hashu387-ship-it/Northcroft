// Registers in each project (migration 0049): EIs in every project, plus any other categories the
// team adds to a project (RFIs, Claims, Letters...). Each item has a reference, title, dates, a
// status, a Northcroft responsible person, the people assigned to it, notes and its own folder in
// the project's Files, where its files and links go.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { supabase } from "./supabase";
import type { RegisterCategory, RegisterItem, RegisterStatus } from "./types";

export const REGISTER_STATUS: Record<RegisterStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "blue" },
  in_progress: { label: "In progress", tone: "orange" },
  waiting: { label: "Waiting", tone: "purple" },
  closed: { label: "Closed", tone: "green" },
};
export const REGISTER_STATUSES: RegisterStatus[] = ["open", "in_progress", "waiting", "closed"];

/** A project's registers: EIs first, then the others in the order they were added. */
export function useRegisterCategories(projectId: string | undefined) {
  return useQuery({
    queryKey: ["register_categories", projectId],
    enabled: !!projectId,
    queryFn: () =>
      unwrap<RegisterCategory[]>(
        supabase.from("register_categories").select("*").eq("project_id", projectId!).order("sort").order("created_at"),
      ),
  });
}

/** Every item in a project's registers, newest first. */
export function useRegisterItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ["register_items", projectId],
    enabled: !!projectId,
    queryFn: () =>
      unwrap<RegisterItem[]>(supabase.from("register_items").select("*").eq("project_id", projectId!).order("created_at", { ascending: false })),
  });
}

/** What one item in a register is called: "EI" for EIs, "RFI" for RFIs, "Claim" for Claims. */
export function itemNoun(c: Pick<RegisterCategory, "name" | "builtin" | "prefix"> | undefined): string {
  if (!c) return "item";
  if (c.builtin) return "EI";
  const n = c.name.trim();
  if (/[^s]s$/i.test(n) && n.length > 3) return n.slice(0, -1);
  return n;
}

/** "EI-242 Hardscaping take-off", or just the title when there's no reference. */
export const itemLabel = (i: Pick<RegisterItem, "ref" | "title">) => (i.ref ? `${i.ref} ${i.title}` : i.title);

/** Order for the list: open ones by due date (no date last), then by reference; closed ones last. */
export function sortItems(list: RegisterItem[]): RegisterItem[] {
  const refKey = (r: string | null) => (r ?? "").replace(/\d+/g, (d) => d.padStart(6, "0")).toLowerCase();
  return [...list].sort((a, b) => {
    const ac = a.status === "closed" ? 1 : 0;
    const bc = b.status === "closed" ? 1 : 0;
    if (ac !== bc) return ac - bc;
    if (!ac) {
      const ad = a.due_on ?? "9999-12-31";
      const bd = b.due_on ?? "9999-12-31";
      if (ad !== bd) return ad < bd ? -1 : 1;
    } else if (a.updated_at !== b.updated_at) {
      return a.updated_at < b.updated_at ? 1 : -1;
    }
    return refKey(a.ref).localeCompare(refKey(b.ref)) || a.title.localeCompare(b.title);
  });
}

export interface ItemValues {
  ref: string;
  title: string;
  description: string;
  status: RegisterStatus;
  received_on: string;
  due_on: string;
  responsible_id: string | null;
  assignees: string[];
  notes: string;
}

const clean = (v: ItemValues) => ({
  ref: v.ref.trim() || null,
  title: v.title.trim(),
  description: v.description.trim() || null,
  status: v.status,
  received_on: v.received_on || null,
  due_on: v.due_on || null,
  responsible_id: v.responsible_id || null,
  assignees: v.assignees,
  notes: v.notes.trim() || null,
});

export async function addItem(category: RegisterCategory, v: ItemValues): Promise<RegisterItem> {
  return unwrap<RegisterItem>(
    supabase
      .from("register_items")
      .insert({ category_id: category.id, project_id: category.project_id, ...clean(v) })
      .select("*")
      .single(),
  );
}

export async function updateItem(id: string, v: ItemValues): Promise<RegisterItem> {
  return unwrap<RegisterItem>(supabase.from("register_items").update(clean(v)).eq("id", id).select("*").single());
}

export async function setItemStatus(id: string, status: RegisterStatus): Promise<void> {
  await unwrap(supabase.from("register_items").update({ status }).eq("id", id).select("id"));
}

export async function removeItem(id: string): Promise<void> {
  const rows = await unwrap<{ id: string }[]>(supabase.from("register_items").delete().eq("id", id).select("id"));
  if (!rows.length) throw new Error("Only whoever added it, or a manager or senior, can remove it.");
}

/** The item's folder in Files, made again if someone removed it. */
export async function itemFolder(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("register_item_folder", { p_item: id });
  if (error) throw error;
  return data as string;
}

export async function addCategory(projectId: string, name: string, prefix: string, meId: string): Promise<RegisterCategory> {
  return unwrap<RegisterCategory>(
    supabase
      .from("register_categories")
      .insert({ project_id: projectId, name: name.trim(), prefix: prefix.trim() || null, created_by: meId })
      .select("*")
      .single(),
  );
}

export async function renameCategory(id: string, name: string, prefix: string): Promise<void> {
  await unwrap(supabase.from("register_categories").update({ name: name.trim(), prefix: prefix.trim() || null }).eq("id", id).select("id"));
}

export async function removeCategory(id: string): Promise<void> {
  const rows = await unwrap<{ id: string }[]>(supabase.from("register_categories").delete().eq("id", id).select("id"));
  if (!rows.length) throw new Error("Only an empty category can be removed. Remove its items first.");
}

/** A friendlier message for a name that's already taken. */
export function categoryError(e: unknown): string | null {
  const msg = (e as { message?: string; code?: string })?.message ?? "";
  if ((e as { code?: string })?.code === "23505" || /duplicate key/i.test(msg)) return "This project already has a category with that name.";
  return null;
}
