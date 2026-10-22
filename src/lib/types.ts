export type Role = "manager" | "member";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "normal" | "high" | "urgent";
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
  assignee_id: string | null;
  reviewer_id: string | null;
  created_by: string | null;
  due_date: string | null;
  estimate_hours: number | null;
  changes_note: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  approved_by: string | null;
  recurring_id: string | null;
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

export interface Comment {
  id: string;
  task_id: string | null;
  project_id: string | null;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
}

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
  created_at: string;
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
  description: string | null;
  status: VoStatus;
  initiated_by: string | null;
  submitted_value: number | null;
  assessed_value: number | null;
  approved_value: number | null;
  submitted_date: string | null;
  approved_date: string | null;
  response_due: string | null;
  owner_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoqPackage {
  id: string;
  project_id: string;
  name: string;
  trade: string | null;
  status: BoqStatus;
  owner_id: string | null;
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
