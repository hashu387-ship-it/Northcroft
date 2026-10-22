// Public client configuration. These values are safe to ship to the browser:
// the publishable key only works together with the row level security rules.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://hfekwhvnyzpneydqrnsz.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_Y37EuUPUMD6K1e12XWgTQQ_WojP0L0X";
export const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  "BPLooF2XssRJB4BMePZzZlq0O2rLkwlDjS7PBOZxWUp2aCk0d1hDav7ooVwmXCuSacmHFFdXm8EFzQa9t0tKrkg";
export const TZ = "Asia/Riyadh";
export const CURRENCY = "SAR";
