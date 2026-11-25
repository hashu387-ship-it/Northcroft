// One colour per destination, shared by the Account page, Settings and the What's new list, in
// the iOS Settings palette: a small rounded tile in the colour with a white symbol. (The tab bar
// and the side menu use the accent colour instead, as Apple's apps do.)
export const MENU_COLOR = {
  home: "#007AFF",
  tasks: "#007AFF",
  projects: "#FF9500",
  volog: "#30B0C7",
  submissions: "#FF2D55",
  updates: "#AF52DE",
  chats: "#34C759",
  calls: "#34C759",
  announcements: "#FF3B30",
  calendar: "#5856D6",
  inbox: "#007AFF",
  attendance: "#00C7BE",
  workload: "#FFCC00",
  time: "#32ADE6",
  settings: "#8E8E93",
  scan: "#007AFF",
  whatsnew: "#FF9500",
  more: "#8E8E93",
} as const;

export type MenuColor = keyof typeof MENU_COLOR;

/** The tile's background: the colour with a little light at the top, like iOS 26 icons. */
export function tileBackground(color: string): string {
  return `linear-gradient(180deg, color-mix(in srgb, ${color} 88%, #fff), ${color} 55%, color-mix(in srgb, ${color} 90%, #000))`;
}

/** Style for a menu tile. */
export function tileStyle(color: string): Record<string, string> {
  return { background: tileBackground(color), "--tile": color };
}
