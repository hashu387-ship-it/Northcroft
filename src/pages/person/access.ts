// What you may see on someone's profile. The database is what really decides (row-level
// security); this only keeps sections you can't see from showing up empty. The rules:
//   tasks, projects and hours logged    everyone
//   attendance times and places         the person, and managers and seniors who see times
//                                       (can_see_team_attendance)
//   present, absent or on leave only    managers and seniors who see presence but not times
//                                       (can_see_team_presence)
//   leave requests and balance          the person, managers and seniors
//   daily updates                       the person, managers and seniors
import { useAuth, useMe } from "@/lib/auth";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import type { Profile } from "@/lib/types";

export interface PersonAccess {
  self: boolean;
  /** Check-in and out times, places and hours. */
  attendanceTimes: boolean;
  /** Present, absent or on leave each day, without times. */
  attendancePresence: boolean;
  leave: boolean;
  updates: boolean;
}

export function usePersonAccess(person: Profile | undefined): PersonAccess {
  const me = useMe();
  const { isManager, canAssign } = useAuth();
  const self = !!person && person.id === me.id;
  const checksIn = !!person && !person.attendance_exempt;
  const seesTimes = me.active !== false && me.attendance_times !== false && (isManager || (canAssign && !me.attendance_exempt));
  const seesPresence = isManager || canAssign;
  const attendanceTimes = checksIn && (self || seesTimes);
  return {
    self,
    attendanceTimes,
    attendancePresence: checksIn && !attendanceTimes && seesPresence,
    leave: checksIn && (self || canAssign),
    updates: !!person && sendsDailyUpdate(person) && (self || canAssign),
  };
}
