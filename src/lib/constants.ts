import type { BoqStatus, EventKind, Priority, TaskStatus, VoStatus } from "./types";

type Tone = "blue" | "green" | "orange" | "red" | "purple" | "teal" | "yellow" | "gray";

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "To do", tone: "gray" },
  in_progress: { label: "In progress", tone: "blue" },
  in_review: { label: "In review", tone: "purple" },
  done: { label: "Done", tone: "green" },
};
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];

export const PRIORITY: Record<Priority, { label: string; tone: Tone; rank: number }> = {
  urgent: { label: "Urgent", tone: "red", rank: 0 },
  high: { label: "High", tone: "red", rank: 1 },
  normal: { label: "Normal", tone: "yellow", rank: 2 },
  low: { label: "Low", tone: "green", rank: 3 },
};
export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "normal", "low"];

export const VO_STATUS: Record<VoStatus, { label: string; tone: Tone; group: "pending" | "approved" | "closed_out" }> = {
  identified: { label: "Identified", tone: "gray", group: "pending" },
  requested: { label: "Proposal requested", tone: "teal", group: "pending" },
  quoted: { label: "Quotation received", tone: "blue", group: "pending" },
  evaluation: { label: "QS evaluation", tone: "purple", group: "pending" },
  recommended: { label: "Recommended", tone: "yellow", group: "pending" },
  approved: { label: "Approved", tone: "green", group: "approved" },
  agreed: { label: "Value agreed", tone: "green", group: "approved" },
  closed: { label: "Closed", tone: "green", group: "approved" },
  rejected: { label: "Rejected", tone: "red", group: "closed_out" },
  withdrawn: { label: "Withdrawn", tone: "gray", group: "closed_out" },
  disputed: { label: "Disputed", tone: "orange", group: "pending" },
};
export const VO_STATUS_ORDER: VoStatus[] = [
  "identified", "requested", "quoted", "evaluation", "recommended", "approved", "agreed", "closed", "disputed", "rejected", "withdrawn",
];

export const BOQ_STATUS: Record<BoqStatus, { label: string; tone: Tone; step: number }> = {
  not_started: { label: "Not started", tone: "gray", step: 0 },
  measuring: { label: "Measuring", tone: "blue", step: 1 },
  pricing: { label: "Pricing", tone: "purple", step: 2 },
  checked: { label: "Checked", tone: "teal", step: 3 },
  issued: { label: "Issued", tone: "green", step: 4 },
};
export const BOQ_STATUS_ORDER: BoqStatus[] = ["not_started", "measuring", "pricing", "checked", "issued"];

export const EVENT_KIND: Record<EventKind, { label: string; color: string }> = {
  site_visit: { label: "Site visit", color: "#FF9F0A" },
  meeting: { label: "Meeting", color: "#0A84FF" },
  // Same orange as a submission's due date (it's the same thing); purple is kept for VO actions and
  // teal for BOQs, so no colour on the calendar means two things.
  submission: { label: "Submission", color: "#DC6B19" },
  leave: { label: "Leave", color: "#5B74A8" },
  other: { label: "Other", color: "#8E8E93" },
};

export const PROJECT_COLORS = ["#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#FF375F", "#5AC8FA", "#FFD60A", "#AC8E68", "#5E5CE6", "#64D2FF"];
export const PERSON_COLORS = ["#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#FF375F", "#5AC8FA", "#FFD60A", "#64D2FF", "#AC8E68"];
