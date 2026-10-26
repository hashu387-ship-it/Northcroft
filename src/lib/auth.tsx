import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { forgetUser, rememberUser } from "./offline";
import { clearOutbox } from "./outbox";
import type { Profile } from "./types";

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isManager: boolean;
  canAssign: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data && !data.active) {
      await supabase.auth.signOut();
      setProfile(null);
      return;
    }
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (mounted) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // The phone keeps a copy of this person's screens for when there's no signal; nobody else's.
      if (s?.user.id) void rememberUser(s.user.id);
      else if (event === "SIGNED_OUT") void forgetUser();
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "SIGNED_OUT") {
        // Defer so we never call Supabase inside the auth callback itself.
        setTimeout(() => loadProfile(s?.user.id), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      isManager: profile?.role === "manager",
      canAssign: !!profile && (profile.role === "manager" || profile.can_assign),
      signIn: async (email, password) => {
        const typed = email.trim().toLowerCase();
        let { data, error } = await supabase.auth.signInWithPassword({ email: typed, password });
        if (error && /invalid login credentials/i.test(error.message)) {
          // An old email someone used to sign in with (their email has changed since): sign in to
          // the same account with its main email. Same password.
          const { data: main } = await supabase.rpc("login_email", { p_email: typed });
          if (typeof main === "string" && main && main !== typed) {
            ({ data, error } = await supabase.auth.signInWithPassword({ email: main, password }));
          }
        }
        if (error) throw error;
        await loadProfile(data.user?.id);
      },
      signOut: async () => {
        // Anything still waiting to send, and the saved copy of their screens, leave with them.
        const id = session?.user.id;
        await supabase.auth.signOut();
        setProfile(null);
        if (id) await clearOutbox(id).catch(() => {});
        await forgetUser();
      },
      refreshProfile: () => loadProfile(session?.user.id),
    }),
    [session, profile, loading, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** The signed-in profile. Only use inside pages behind the auth gate. */
export function useMe(): Profile {
  const { profile } = useAuth();
  if (!profile) throw new Error("Not signed in");
  return profile;
}
