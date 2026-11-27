import { QsTitle } from "./Brand";

/** Branded launch screen, shown while the app checks who is signed in. Matches the one in index.html. */
export function Splash({ label = "Opening Northcroft" }: { label?: string }) {
  return (
    <div className="boot" role="status" aria-label={label}>
      <div className="boot-inner">
        <QsTitle size={56} className="boot-title" />
        <span className="boot-bar" aria-hidden />
      </div>
    </div>
  );
}
