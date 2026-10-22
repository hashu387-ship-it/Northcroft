import { LogoMark, Wordmark } from "./Brand";

/** Branded launch screen, shown while the app checks who is signed in. Matches the one in index.html. */
export function Splash({ label = "Opening Northcroft" }: { label?: string }) {
  return (
    <div className="boot" role="status" aria-label={label}>
      <div className="boot-inner">
        <LogoMark variant="white" size={92} />
        <Wordmark height={30} style={{ color: "#fff" }} />
        <span className="boot-bar" aria-hidden />
      </div>
    </div>
  );
}
