// One colour per menu item, shared by the side menu, the bottom tabs and the More page so each
// place matches. Shown as a small rounded tile behind a white icon.
export const MENU_COLOR = {
  home: "#0A84FF",
  tasks: "#5E5CE6",
  projects: "#FF9F0A",
  volog: "#1D6F42",
  updates: "#AF52DE",
  chats: "#30D158",
  announcements: "#F13E44",
  calendar: "#E91E63",
  inbox: "#0FA3B1",
  attendance: "#A2845E",
  workload: "#C9A227",
  settings: "#3A6EA5",
  more: "#F13E44",
} as const;

export type MenuColor = keyof typeof MENU_COLOR;

/** The tile's background: the colour, a little darker towards the bottom right. */
export function tileBackground(color: string): string {
  return `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 70%, #000))`;
}
