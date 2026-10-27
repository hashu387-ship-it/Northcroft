// Tasks team members make (Hassan approves them first), tasks on hold, and Hassan's choice to
// finish handed-in work himself or send it on to Fawaz.
//
// The approver is the first checker in Settings > Team > Task sign-off (Hassan); with none set,
// the managers approve. The database enforces all of this (guard_task); these helpers decide what
// to show.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useMe } from "./auth";
import { useSignoff } from "./signoff";
import { supabase } from "./supabase";
import type { Task } from "./types";

export function useApprover() {
  const me = useMe();
  const { isManager } = useAuth();
  const signoff = useSignoff();
  return useMemo(() => {
    const first = signoff.first;
    return {
      /** This person approves the tasks the team makes and decides on holds. */
      isApprover: first ? first.id === me.id : isManager,
      /** "Hassan", for "Waiting for Hassan's OK". */
      name: first?.short_name ?? "a manager",
      id: first?.id ?? null,
    };
  }, [signoff.first, me.id, isManager]);
}

/**
 * Tasks waiting for approval or turned down. The database only shows them to whoever made them
 * and to the approver, so for a team member this is their own requests and for Hassan it's all.
 */
export function useTaskRequests() {
  return useQuery({
    queryKey: ["tasks", "requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").not("approval", "is", null).order("created_at", { ascending: true }).limit(300);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });
}

export const isWaitingForOk = (t: Pick<Task, "approval">) => t.approval === "pending";
export const isOnHold = (t: Pick<Task, "hold">) => t.hold === "on";
export const isHoldAsked = (t: Pick<Task, "hold">) => t.hold === "asked";
