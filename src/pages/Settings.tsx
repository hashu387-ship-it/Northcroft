import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import { BellRing, ChevronRight, Clock, HardDrive, Info, KeyRound, MapPin, Smartphone, SunMoon, User, Users } from "lucide-react";
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
import { IphoneSection } from "./settings/IphoneSection";
import { isNativeApp } from "@/native/platform";
import "@/styles/admin.css";
import { showsManagerLabel } from "@/lib/people";

interface SectionDef {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
  /** Which group it sits in on the phone list (like the blocks in iOS Settings). */
  group: "you" | "team" | "about";
}

// Tile colours follow iOS Settings: blue for display, red for notifications, grey for system things.
const ALL_SECTIONS: SectionDef[] = [
  { id: "iphone", label: "iPhone app", hint: "Face ID, widgets, Siri, calendar and scanning", icon: Smartphone, color: "#34C759", group: "you" },
  { id: "profile", label: "Profile", hint: "Name, short name and phone", icon: User, color: "#8E8E93", group: "you" },
  { id: "notifications", label: "Notifications", hint: "Phone and desktop alerts", icon: BellRing, color: "#FF3B30", group: "you" },
  { id: "appearance", label: "Appearance", hint: "Light, dark, glass, text size and app icon", icon: SunMoon, color: "#007AFF", group: "you" },
  { id: "password", label: "Password", hint: "Change your password", icon: KeyRound, color: "#8E8E93", group: "you" },
  { id: "team", label: "Team", hint: "People, access and passwords", icon: Users, color: "#5856D6", group: "team" },
  { id: "hours", label: "Working hours", hint: "Start, finish and working days", icon: Clock, color: "#FF9500", group: "team" },
  { id: "places", label: "Office and sites", hint: "Where check-ins are matched", icon: MapPin, color: "#34C759", group: "team" },
  { id: "drive", label: "Google Drive", hint: "Where attachments are saved", icon: HardDrive, color: "#30B0C7", group: "team" },
  { id: "about", label: "Install and about", hint: "Phone install guide, sign out", icon: Info, color: "#8E8E93", group: "about" },
];
const GROUP_TITLES: Record<SectionDef["group"], string | undefined> = { you: undefined, team: "Team", about: undefined };

// "iPhone app" only shows inside the Northcroft iPhone app.
const SECTIONS = ALL_SECTIONS.filter((s) => s.id !== "iphone" || isNativeApp());

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
    case "iphone":
      return <IphoneSection />;
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
      <PageHead title={!isDesktop && current ? current.label : "Settings"} sub={!isDesktop && active ? undefined : "Your profile, notifications and how the team works."} />
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
            <div>
              <div className="group">
                <Link to="/settings/profile" className="group-row profile">
                  <Avatar person={me} size={58} />
                  <span className="label">
                    <b>{me.full_name}</b>
                    <small>
                      {me.title}
                      {isManager ? (showsManagerLabel(me) ? " · Manager" : "") : canAssign ? " · Can assign tasks" : ""}
                    </small>
                  </span>
                  <ChevronRight className="chev" />
                </Link>
              </div>
              {(["you", "team", "about"] as const).map((g) => {
                const rows = SECTIONS.filter((s) => s.group === g && s.id !== "profile");
                if (!rows.length) return null;
                return (
                  <div key={g} style={{ marginTop: GROUP_TITLES[g] ? 0 : 22 }}>
                    {GROUP_TITLES[g] && <div className="group-title">{GROUP_TITLES[g]}</div>}
                    <div className="group">
                      {rows.map((s) => (
                        <Link key={s.id} to={`/settings/${s.id}`} className="group-row">
                          <span className="tile" style={{ background: s.color }}>
                            <s.icon />
                          </span>
                          <span className="label">
                            {s.label}
                            <small>{s.hint}</small>
                          </span>
                          <ChevronRight className="chev" />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
