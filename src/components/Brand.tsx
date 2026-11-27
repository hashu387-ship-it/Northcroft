// The app's name where a logo would usually go. The Northcroft logo is no longer shown inside the
// app or on its reports (only the app icon keeps it); the logo files stay in public/brand.

/**
 * "QS Team" in plain text, where the logo used to be the main thing on a screen (the opening screen,
 * sign-in, the Face ID lock, Settings > About). It takes the colour of the text around it. `size` is
 * the font size. `hidden`: a heading for screen readers already says the name.
 */
export function QsTitle({ size = 40, className, hidden }: { size?: number; className?: string; hidden?: boolean }) {
  return (
    <span className={className ? `qs-title ${className}` : "qs-title"} style={{ fontSize: size }} aria-hidden={hidden || undefined}>
      QS Team
    </span>
  );
}
