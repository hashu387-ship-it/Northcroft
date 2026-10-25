import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import { BellRing, ChevronRight, Clock, HardDrive, Info, KeyRound, MapPin, SunMoon, User, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth, useMe } from "@/lib/auth";
import { PageHead } from "@/components/PageHead";
import { Avatar } from "@/components/ui";
import ChangePassword from "./ChangePassword";
import { Section } from "./settings/common";
import { ProfileSection } from "./settings/ProfileSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { TeamSection } from "./settings/TeamSection";
import { HoursSection } from "./settings/HoursSection";
import { PlacesSection } from "./settings/PlacesSection";
import { DriveSection } from "./settings/DriveSection";
import { AboutSection } from "./settings/AboutSection";
import "@/styles/admin.css";
import { showsManagerLabel } from "@/lib/people";

interface SectionDef {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
}

const SECTIONS: SectionDef[] = [
  { id: "profile", label: "Profile", hint: "Name, short name and phone", icon: User, color: "#1B3570" },
  { id: "password", label: "Password", hint: "Change your password", icon: KeyRound, color: "#1B3570" },
  { id: "notifications", label: "Notifications", hint: "Phone and desktop alerts", icon: BellRing, color: "#1B3570" },
  { id: "appearance", label: "Appearance", hint: "Light, dark and solid surfaces", icon: SunMoon, color: "#1B3570" },
  { id: "team", label: "Team", hint: "People, access and passwords", icon: Users, color: "#1B3570" },
  { id: "hours", label: "Working hours", hint: "Start, finish and working days", icon: Clock, color: "#1B3570" },
  { id: "places", label: "Office and sites", hint: "Where check-ins are matched", icon: MapPin, color: "#1B3570" },
  { id: "drive", label: "Google Drive", hint: "Where attachments are saved", icon: HardDrive, color: "#1B3570" },
  { id: "about", label: "Install and about", hint: "Phone install guide, sign out", icon: Info, color: "#1B3570" },
];

function useIsDesktop() {
  const query = "(min-width: 900px)";
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return match;
}

function SectionBody({ id }: { id: string }) {
  switch (id) {
    case "profile":
      return <ProfileSection />;
    case "password":
      return (
        <Section title="Password" sub="Use at least 8 characters. Something you'll remember but others won't guess.">
          <div style={{ maxWidth: 420 }}>
            <ChangePassword />
          </div>
        </Section>
      );
    case "notifications":
      return <NotificationsSection />;
    case "appearance":
      return <AppearanceSection />;
    case "team":
      return <TeamSection />;
    case "hours":
      return <HoursSection />;
    case "places":
      return <PlacesSection />;
    case "drive":
      return <DriveSection />;
    case "about":
      return <AboutSection />;
    default:
      return null;
  }
}

export default function Settings() {
  const { section } = useParams();
  const me = useMe();
  const { isManager, canAssign } = useAuth();
  const isDesktop = useIsDesktop();
  const current = SECTIONS.find((s) => s.id === section);

  if (section && !current) return <Navigate to="/settings" replace />;
  const active = current ?? (isDesktop ? SECTIONS[0] : null);

  return (
    <div className="page">
      <PageHead title="Settings" sub={!isDesktop && active ? undefined : "Your profile, notifications and how the team works."} />
      <div className="settings-layout">
        <nav className="settings-nav glass" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className={() => (active?.id === s.id ? "active" : "")}>
              <span className="settings-icon" style={{ background: s.color }}>
                <s.icon />
              </span>
              {s.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ minWidth: 0 }}>
          {active ? (
            <SectionBody id={active.id} />
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              <Link to="/settings/profile" className="glass card row" style={{ color: "inherit", gap: 14 }}>
                <Avatar person={me} size={56} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="bold" style={{ fontSize: 16 }}>
                    {me.full_name}
                  </div>
                  <div className="muted small">
                    {me.title}
                    {isManager ? (showsManagerLabel(me) ? " · Manager" : "") : canAssign ? " · Can assign tasks" : ""}
                  </div>
                </div>
                <ChevronRight size={18} className="faint" />
              </Link>
              <div className="glass settings-list" style={{ padding: "4px 6px" }}>
                {SECTIONS.filter((s) => s.id !== "profile").map((s) => (
                  <Link key={s.id} to={`/settings/${s.id}`}>
                    <span className="settings-icon" style={{ background: s.color }}>
                      <s.icon />
                    </span>
                    <span className="grow">
                      {s.label}
                      <small>{s.hint}</small>
                    </span>
                    <ChevronRight size={18} className="faint" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
