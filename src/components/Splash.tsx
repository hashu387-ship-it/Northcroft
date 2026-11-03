import { TeamBadge } from "./Brand";

/** Branded launch screen, shown while the app checks who is signed in. Matches the one in index.html. */
export function Splash({ label = "Opening Northcroft" }: { label?: string }) {
  return (
    <div className="boot" role="status" aria-label={label}>
      <div className="boot-inner">
        <TeamBadge size={168} className="boot-badge" />
        <span className="boot-bar" aria-hidden />
      </div>
    </div>
  );
}
