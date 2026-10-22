import "@/styles/comms.css";
import { AtSign } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { CommentThread } from "@/components/CommentThread";
import { usePeople } from "@/lib/api";
import { AvatarStack } from "@/components/ui";

export default function TeamChat() {
  const people = usePeople();
  return (
    <div className="page">
      <PageHead
        title="Team chat"
        sub="One place for the whole QS team. Project conversations live inside each project."
        actions={<AvatarStack people={people.active} size={30} max={7} />}
      />
      <div className="glass-strong chat-card" style={{ borderRadius: "var(--r-xl)" }}>
        <div className="chat-tip">
          <AtSign />
          <span>
            Type @ and a name to notify someone on their phone, or @all to notify everyone.
          </span>
        </div>
        <CommentThread scope={{ kind: "team" }} height="max(320px, calc(100dvh - 330px))" placeholder="Message the team" />
      </div>
    </div>
  );
}
