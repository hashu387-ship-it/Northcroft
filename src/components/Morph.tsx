// A link whose card grows into the page it opens (see lib/morph).
import { createPath, Link, useNavigate, type LinkProps } from "react-router-dom";
import { canMorph, morphTo } from "@/lib/morph";

export function MorphLink({ morphKey, to, onClick, children, ...rest }: LinkProps & { morphKey: string }) {
  const navigate = useNavigate();
  return (
    <Link
      {...rest}
      to={to}
      data-morph-src={morphKey}
      onClick={(e) => {
        onClick?.(e);
        // Only a plain tap or click; new-tab clicks and the like work as usual.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !canMorph()) return;
        e.preventDefault();
        morphTo(navigate, typeof to === "string" ? to : createPath(to), morphKey, e.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}
