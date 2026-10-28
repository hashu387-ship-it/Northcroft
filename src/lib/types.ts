export type Role = "manager" | "member";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ReviewStage = "first" | "final";
export type VoStatus =
  | "identified" | "requested" | "quoted" | "evaluation" | "recommended"
  | "approved" | "agreed" | "closed" | "rejected" | "withdrawn" | "disputed";
export type BoqStatus = "not_started" | "measuring" | "pricing" | "checked" | "issued";
export type EventKind = "site_visit" | "meeting" | "submission" | "leave" | "other";
export type PlaceKind = "office" | "site";

export interface Profile {
  id: string;
  full_name: string;
  short_name: string;
  email: string;
  title: string;
  role: Role;
  can_assign: boolean;
  color: string;
  active: boolean;
  must_change_password: boolean;
  phone: string | null;
  avatar_url: string | null;
  /** Doesn't check in or out (e.g. the Commercial Manager); left off attendance lists. */
  attendance_exempt: boolean;
  /** False when nobody else can give this person tasks (they can still give themselves one). */
  assignable: boolean;
  /** False for a manager who sees who is present, absent or on leave, but not check-in times or places. */
  attendance_times: boolean;
  created_at: string;
}

export interface AppSettings {
  id: 1;
  company_name: string;
  timezone: string;
  currency: string;
  work_start: string; // "08:30:00"
  work_end: string;
  grace_minutes: number;
  work_days: number[]; // 0 = Sunday
  weekly_task_capacity: number;
  /** Google Drive for files over 50 MB: whose Drive, the Northcroft folder, and when it was connected. */
  drive_account: string | null;
  drive_root_id: string | null;
  drive_general_id: string | null;
  drive_connected_at: string | null;
  /** When a manager added the Google key for shared Drive links (the key itself stays private). */
  drive_key_added_at?: string | null;
  /** Task sign-off: who checks handed-in work first, and who gives the final OK after them. */
  first_checker_id?: string | null;
  final_checker_id?: string | null;
  /** Check in and check out only inside an office's radius in Settings > Places (on unless a manager turns it off). */
  office_only_checkin?: boolean;
  updated_at: string;
}

export interface Project {
  id: string;
  code: string | null;
  name: string;
  client: string | null;
  city: string | null;
  contract_value: number | null;
  status: "active" | "on_hold" | "completed";
  color: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  cover_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  /** The first person on the task (kept for older screens); `assignees` is the full list. */
  assignee_id: string | null;
  /** Everyone on the task: they all see it, get its notifications, and can update and submit it. */
  assignees: string[];
  reviewer_id: string | null;
  created_by: string | null;
  due_date: string | null;
  estimate_hours: number | null;
  changes_note: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  approved_by: string | null;
  /** While in review with the two-step sign-off: "first" waits for the first checker, "final" for the final OK. */
  review_stage?: ReviewStage | null;
  /** Who gave the first OK, and when (the task then waits for the final OK). */
  first_ok_by?: string | null;
  first_ok_at?: string | null;
  recurring_id: string | null;
  /** The repeating task it was made from; kept even if that repeating task is removed. */
  repeat_of?: string | null;
  /** A task a team member made: "pending" waits for the approver's OK (Hassan), "declined" was
   *  turned down (approval_note says why). null: an ordinary task. */
  approval?: "pending" | "declined" | null;
  approval_note?: string | null;
  approval_at?: string | null;
  approval_by?: string | null;
  /** On hold: "asked" by someone on it (waiting for the approver), or "on" (paused, no reminders). */
  hold?: "asked" | "on" | null;
  hold_reason?: string | null;
  hold_by?: string | null;
  hold_at?: string | null;
  /** The first checker (Hassan) finished it without sending it to the final checker (Fawaz). */
  finished_by_first?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  assignee_id: string | null;
  position: number;
  done_by: string | null;
  done_at: string | null;
  /** Set when the step was taken off the list (kept for the history). */
  removed_at: string | null;
  created_at: string;
}

export interface RecurringTask {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  assignee_id: string | null;
  reviewer_id: string | null;
  /** Everyone each new task goes to (assignee_id is the first of them). */
  assignees: string[];
  frequency: "daily" | "weekly" | "monthly";
  weekday: number | null;
  month_day: number | null;
  due_offset_days: number;
  estimate_hours: number | null;
  checklist: string[];
  next_run: string;
  last_run: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export type TranscriptStatus = "pending" | "done" | "failed" | "off";

export interface Comment {
  id: string;
  task_id: string | null;
  project_id: string | null;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  /** Voice note (audio in the private files bucket) and its English text. */
  voice_path: string | null;
  voice_seconds: number | null;
  voice_peaks: number[] | null;
  transcript: string | null;
  transcript_status: TranscriptStatus | null;
  /** Set for messages in a private one-to-one or group chat. */
  conversation_id: string | null;
  /** The message this one replies to (it may since have been taken down). */
  reply_to: string | null;
  /** Grey group lines such as "Hassan added Rimash"; null for normal messages. */
  event: ChatEvent | null;
  /** Set when the message was forwarded from another one (shown as "Forwarded"). */
  forwarded_from?: string | null;
}

export type ChatEvent = "created" | "added" | "removed" | "left" | "renamed" | "admin";

export interface Attachment {
  id: string;
  task_id: string | null;
  project_id: string | null;
  comment_id: string | null;
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
  uploaded_by: string | null;
  /** Set when the file is in Google Drive rather than the app's storage. */
  drive_file_id: string | null;
  /** Set for files in a private one-to-one or group chat. */
  conversation_id: string | null;
  /** For an edited copy: the first version of the file. */
  version_of: string | null;
  /** 1 for the original, 2 for the first edited copy, and so on. */
  version: number;
  /** Set for a file added with a repeating task: it shows on every copy of the task. */
  recurring_id?: string | null;
  /** Set for a file on a variation; with vo_round, it belongs to that submission (sent or assessment side). */
  variation_id?: string | null;
  vo_round?: string | null;
  vo_side?: "sent" | "assessment" | null;
  /** Set for a file on an announcement. */
  announcement_id?: string | null;
  /** Set for a file on a leave request (only the person and managers see it). */
  leave_id?: string | null;
  /** For a file added to the project itself: the folder it's in (null: the top of the Project folder). */
  project_folder_id?: string | null;
  created_at: string;
}

/** A folder in a project's Project folder (folders can be inside folders). */
export interface ProjectFolder {
  id: string;
  project_id: string;
  /** null: at the top of the Project folder. */
  parent_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
  removed_at: string | null;
}

/* ---------------------------------------------------------------- chats */
export interface Conversation {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  direct_key: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  is_admin: boolean;
  added_by: string | null;
  joined_at: string;
  left_at: string | null;
}

/** One row of the Chats list (from the my_chats() database function). */
export interface ChatSummary {
  /** "team", "project:<id>" or "conv:<id>" */
  chat: string;
  kind: "team" | "project" | "direct" | "group";
  conversation_id: string | null;
  project_id: string | null;
  name: string;
  members: string[] | null;
  is_admin: boolean;
  last_at: string | null;
  last_body: string | null;
  last_author: string | null;
  last_voice: boolean;
  last_event: ChatEvent | null;
  unread: number;
}

export interface ChatRead {
  user_id: string;
  chat: string;
  read_at: string;
}

export type ReactionKind = "like" | "done" | "love" | "haha" | "thanks" | "sad";

export interface Reaction {
  comment_id: string;
  user_id: string;
  /** null when the reaction was taken back */
  reaction: ReactionKind | null;
  updated_at: string;
}

export interface Activity {
  id: number;
  project_id: string | null;
  task_id: string | null;
  entity: "task" | "variation" | "boq" | "project" | "announcement";
  entity_id: string | null;
  actor_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  author_id: string | null;
  project_id: string | null;
  important: boolean;
  requires_ack: boolean;
  pinned: boolean;
  nudged_at: string | null;
  created_at: string;
  /** Voice note (audio in the private files bucket) and its English text. */
  voice_path: string | null;
  voice_seconds: number | null;
  voice_peaks: number[] | null;
  transcript: string | null;
  transcript_status: TranscriptStatus | null;
}

export interface AnnouncementAck {
  announcement_id: string;
  user_id: string;
  acked_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  project_id: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  attendees: string[];
  created_by: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  task_id: string | null;
  project_id: string | null;
  announcement_id: string | null;
  read_at: string | null;
  archived_at: string | null;
  push_status: string | null;
  created_at: string;
}

export interface Variation {
  id: string;
  project_id: string;
  vo_number: string;
  title: string;
  priority: Priority;
  description: string | null;
  status: VoStatus;
  initiated_by: string | null;
  submitted_value: number | null;
  assessed_value: number | null;
  approved_value: number | null;
  submitted_date: string | null;
  approved_date: string | null;
  response_due: string | null;
  /** The first owner (kept for older screens); `owners` is the full list. */
  owner_id: string | null;
  owners: string[];
  notes: string | null;
  /* From the VO log (0027): the log's own reference and status, scope, key dates, QS remarks,
     and each submission with ECJV's response. */
  log_ref?: string | null;
  log_status?: string | null;
  scope?: string | null;
  instruction_date?: string | null;
  contract_due?: string | null;
  expected_completion?: string | null;
  qs_remarks?: string | null;
  submissions?: VoSubmission[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One round of a variation: what was sent to the main contractor and what they answered. */
export interface VoSubmission {
  /** Set by the database when the round is saved; files and links on the round point to it. */
  key?: string;
  /** The revision's name ("Rev 0", "Rev 1"). */
  rev?: string | null;
  sent: string | null;
  /** When the log has words instead of a date ("Submitted under EI-210"). */
  sent_note: string | null;
  /** What we asked for in this revision (SAR). */
  submitted_value?: number | null;
  /** What ECJV assessed it at (SAR). */
  assessed_value?: number | null;
  /** ECJV's comments on this revision. */
  response: string | null;
  response_on: string | null;
}

export interface BoqPackage {
  id: string;
  project_id: string;
  name: string;
  priority: Priority;
  trade: string | null;
  status: BoqStatus;
  /** The first owner (kept for older screens); `owners` is the full list. */
  owner_id: string | null;
  owners: string[];
  due_date: string | null;
  value: number | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  project_id: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  address: string | null;
  active: boolean;
  created_at: string;
}

export interface Attendance {
  id: string;
  user_id: string;
  work_date: string;
  check_in_at: string;
  in_lat: number | null;
  in_lng: number | null;
  in_accuracy: number | null;
  in_address: string | null;
  in_place_id: string | null;
  in_place_name: string | null;
  in_place_kind: "office" | "site" | "elsewhere" | "unknown" | null;
  check_out_at: string | null;
  out_lat: number | null;
  out_lng: number | null;
  out_accuracy: number | null;
  out_address: string | null;
  out_place_id: string | null;
  out_place_name: string | null;
  out_place_kind: "office" | "site" | "elsewhere" | "unknown" | null;
  late_minutes: number;
  early_minutes: number;
  note: string | null;
  created_at: string;
}

/* ---------------------------------------------------------------- meeting action points (0026) */

export interface EventAction {
  id: string;
  event_id: string;
  body: string;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  task_id: string | null;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  removed_by: string | null;
}

/* ---------------------------------------------------------------- leave requests (migration 0023) */
export type LeaveKind = "annual" | "sick" | "emergency" | "unpaid" | "other";
export type LeaveStatus = "pending" | "approved" | "declined" | "cancelled";

export interface LeaveRequest {
  id: string;
  user_id: string;
  kind: LeaveKind;
  start_date: string;
  end_date: string;
  /** Working days in the request (counted by the database from the work days in Settings). */
  days: number;
  note: string | null;
  status: LeaveStatus;
  /** Whose turn it is while pending: the first check or the final OK. */
  stage: "first" | "final" | null;
  first_ok_by: string | null;
  first_ok_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One person's annual leave for a year (leave_balances). */
export interface LeaveBalance {
  user_id: string;
  allowance: number;
  used: number;
  pending: number;
  remaining: number;
}

/** Someone away between two dates (team_leave): approved requests and Leave entries on the Calendar.
 *  `kind` is null when the viewer isn't allowed to see the reason. */
export interface TeamLeave {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  days: number;
  kind: LeaveKind | null;
  source: "request" | "event";
}

// Each person's yearly annual leave allowance (set by a manager in Settings > Team).
export interface Profile {
  annual_leave_days?: number;
}

/* ---------------------------------------------------------------- Working without signal (0025) */

/** Check-ins and check-outs made with no signal: recorded at the phone's time, flagged, with when they arrived. */
export interface Attendance {
  in_sent_later?: boolean;
  in_received_at?: string | null;
  out_sent_later?: boolean;
  out_received_at?: string | null;
}

/* ---------------------------------------------------------------- pinned messages and polls */

/** A message pinned to the top of a chat (up to 3 per chat). */
export interface ChatPin {
  comment_id: string;
  /** "team", "project:<id>" or "conv:<id>" */
  chat: string;
  pinned_by: string;
  pinned_at: string;
  unpinned_at: string | null;
  unpinned_by: string | null;
}

/** A poll in a chat (comment_id) or under an announcement (announcement_id). */
export interface Poll {
  id: string;
  comment_id: string | null;
  announcement_id: string | null;
  question: string;
  options: string[];
  /** More than one answer allowed. */
  multi: boolean;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

/** One person's answers on a poll (numbered from 0; empty once they take their vote back). */
export interface PollVote {
  poll_id: string;
  user_id: string;
  choices: number[];
  updated_at: string;
}

/* ---------------------------------------------------------------- daily updates (0028) */

// Whether this person sends a daily update (on for the team; managers are off). Set in Settings > Team.
export interface Profile {
  daily_update?: boolean;
}

// How far each task has got (0 to 100), from the latest daily update.
export interface Task {
  progress?: number;
  progress_at?: string | null;
}

/** One person's update for one day: what they did on each task, other work and anything blocking them. */
export interface DailyUpdate {
  id: string;
  user_id: string;
  work_date: string;
  other_work: string | null;
  blockers: string | null;
  /** A manager or senior replied to the blocker, which cleared it (0042). A new blocker clears these. */
  blocker_cleared_by?: string | null;
  blocker_cleared_at?: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

/** One task in a daily update: where it was, where it is now, and what was done on it. */
export interface DailyUpdateItem {
  id: string;
  update_id: string;
  task_id: string;
  /** The task's title when the update was sent. */
  task_title: string;
  project_id: string | null;
  progress_before: number;
  progress: number;
  note: string | null;
  /** Reached 100% in this update, so it went in for review. */
  handed_in: boolean;
  /** A manager or senior who changed this line after it was sent (0040). */
  edited_by?: string | null;
  edited_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** A reply under what's blocking someone in their daily update (0040). */
export interface DailyUpdateReply {
  id: string;
  update_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

/* ---------------------------------------------------------------- lunch breaks and the office check (0029) */

export interface AppSettings {
  /** Lunch break rules and the 12:35 office check are on. */
  break_rules_on?: boolean;
  /** When lunch starts, team time ("12:00:00"). */
  break_start?: string;
  /** How long lunch is, in minutes. */
  break_minutes?: number;
  /** When people who haven't gone out are asked to confirm they're in the office ("12:35:00"). */
  break_confirm_at?: string;
}

export interface Profile {
  /** Follows the lunch break rules and the office check (off for Hassan). */
  break_rules?: boolean;
}

/** One person's lunch on one day: the office check and the break, each with where it was tapped. */
export interface LunchBreak {
  user_id: string;
  work_date: string;
  prompted_at: string | null;
  confirm_asked_at: string | null;
  missed_at: string | null;
  confirmed_at: string | null;
  confirm_lat: number | null;
  confirm_lng: number | null;
  confirm_accuracy: number | null;
  confirm_address: string | null;
  confirm_place_name: string | null;
  confirm_place_kind: Attendance["in_place_kind"] | null;
  confirm_in_office: boolean | null;
  confirm_distance_m: number | null;
  /** First time they confirmed from outside the office (the watchers were told then). */
  outside_at: string | null;
  break_start_at: string | null;
  start_lat: number | null;
  start_lng: number | null;
  start_accuracy: number | null;
  start_address: string | null;
  start_place_name: string | null;
  start_place_kind: Attendance["in_place_kind"] | null;
  break_end_at: string | null;
  end_lat: number | null;
  end_lng: number | null;
  end_accuracy: number | null;
  end_address: string | null;
  end_place_name: string | null;
  end_place_kind: Attendance["in_place_kind"] | null;
  end_in_office: boolean | null;
  end_distance_m: number | null;
  reminded_left_at: string | null;
  reminded_over_at: string | null;
  watchers_told_at: string | null;
  created_at: string;
  updated_at: string;
}
