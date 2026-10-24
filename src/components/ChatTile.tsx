// The round picture for a chat: the logo for Team chat, the project, the person, or the group's initials.
import clsx from "clsx";
import { FolderKanban, Users } from "lucide-react";
import { PERSON_COLORS } from "@/lib/constants";
import { initials } from "@/lib/format";
import type { ChatItem } from "@/lib/chats";
import type { Profile, Project } from "@/lib/types";
import { Avatar } from "./ui";
import { LogoMark } from "./Brand";

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

export function ChatTile({ item, project, person, small }: { item: Pick<ChatItem, "kind" | "conversation_id" | "title">; project?: Project; person?: Profile; small?: boolean }) {
  if (item.kind === "team") return <LogoMark variant="tile" size={small ? 38 : 46} className="chat-tile-logo" />;
  if (item.kind === "direct") return <Avatar person={person} size={small ? 38 : 46} />;
  if (item.kind === "project") {
    return (
      <span className={clsx("chat-tile project", small && "sm")} style={{ background: project?.color ?? "#0a84ff" }}>
        {project?.cover_url ? <img src={project.cover_url} alt="" /> : <FolderKanban />}
      </span>
    );
  }
  const c = colorFor(item.conversation_id ?? item.title);
  return (
    <span className={clsx("chat-tile", small && "sm")} style={{ background: `linear-gradient(145deg, ${c}, color-mix(in srgb, ${c} 68%, #000))` }}>
      {initials(item.title) || <Users />}
    </span>
  );
}
