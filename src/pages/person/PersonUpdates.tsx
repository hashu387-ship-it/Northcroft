// A person's recent daily updates: what they reported on each task, anything blocking them, and
// the replies.
import "@/styles/updates.css";
import { ClipboardList } from "lucide-react";
import { useMyDailyUpdates } from "@/lib/dailyUpdates";
import type { Profile } from "@/lib/types";
import { Empty, Loading } from "@/components/ui";
import { UpdateCard } from "../updates/UpdateCard";

export function PersonUpdates({ person, self }: { person: Profile; self: boolean }) {
  const updates = useMyDailyUpdates(person.id);
  if (updates.isLoading) return <Loading rows={3} />;
  const list = (updates.data ?? []).filter((u) => u.submitted_at).slice(0, 14);
  if (!list.length) {
    return (
      <div className="glass">
        <Empty icon={<ClipboardList />} title="No daily updates yet">
          {self ? "Your" : `${person.short_name}'s`} evening updates will show up here.
        </Empty>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      {list.map((u) => (
        <UpdateCard key={u.id} update={u} />
      ))}
    </div>
  );
}
