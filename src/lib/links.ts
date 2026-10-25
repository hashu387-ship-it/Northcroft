// Links that aren't Google Drive: OneDrive and SharePoint, Dropbox, WeTransfer, or any website.
// They show as a card that opens the link. This works out what the link is from its address (a
// OneDrive folder, an Excel file on SharePoint, a Dropbox PDF) and a name to start from, which the
// person can change. The page's own title is asked for through the drive function (web_info).
import { driveCall } from "./drive";
import type { LinkInfo, LinkProvider } from "./drivelinks";

export interface OtherLink {
  provider: Exclude<LinkProvider, "google">;
  /** OneDrive, SharePoint, Dropbox, WeTransfer, or the website's address. */
  site: string;
  kind: "folder" | "file";
  /** "Folder", "Excel file", "PDF", "Link"... */
  what: string;
  /** A name to start from: the file name in the address if there is one. */
  name: string;
  /** True when the name is the file name from the address (it beats the page's title). */
  fromAddress: boolean;
}

/** The address with https:// added when someone pasted "www.example.com". Null if it isn't a link. */
export function normalizeUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (/^www\./i.test(v)) v = `https://${v}`;
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// The letter Microsoft puts in share links: 1drv.ms/x/... or sharepoint.com/:x:/...
const MS_KIND: Record<string, { kind: "folder" | "file"; what: string }> = {
  f: { kind: "folder", what: "Folder" },
  x: { kind: "file", what: "Excel file" },
  w: { kind: "file", what: "Word file" },
  p: { kind: "file", what: "PowerPoint file" },
  b: { kind: "file", what: "File" },
  i: { kind: "file", what: "Photo" },
  v: { kind: "file", what: "Video" },
  u: { kind: "file", what: "File" },
  o: { kind: "file", what: "OneNote notebook" },
};

const EXT_WHAT: [RegExp, string][] = [
  [/\.pdf$/i, "PDF"],
  [/\.(xlsx?|xlsm|csv)$/i, "Excel file"],
  [/\.docx?$/i, "Word file"],
  [/\.pptx?$/i, "PowerPoint file"],
  [/\.(jpe?g|png|gif|webp|heic)$/i, "Photo"],
  [/\.(mp4|mov|webm)$/i, "Video"],
  [/\.(dwg|dxf)$/i, "Drawing"],
  [/\.zip$/i, "Zip file"],
];

function fileNameIn(u: URL): string | null {
  const parts = u.pathname.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    let seg = parts[i];
    try {
      seg = decodeURIComponent(seg);
    } catch {
      /* keep it as it is */
    }
    if (/\.[a-z0-9]{2,5}$/i.test(seg) && !/\.(aspx?|php|html?)$/i.test(seg)) return seg.slice(0, 160);
  }
  return null;
}

function whatForName(name: string | null, fallback: string) {
  if (!name) return fallback;
  return EXT_WHAT.find(([re]) => re.test(name))?.[1] ?? "File";
}

/** What a non-Google link is, from its address alone. */
export function describeLink(url: string): OtherLink {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const file = fileNameIn(u);

  if (host === "1drv.ms" || host.endsWith("onedrive.live.com") || host === "onedrive.com") {
    const letter = host === "1drv.ms" ? u.pathname.split("/").filter(Boolean)[0] : "";
    const k = MS_KIND[letter] ?? (u.searchParams.has("id") && /folder/i.test(url) ? MS_KIND.f : null);
    const what = k?.what ?? whatForName(file, "Link");
    const fallback = k?.kind === "folder" ? "OneDrive folder" : what === "Link" ? "OneDrive link" : `${what} on OneDrive`;
    return { provider: "onedrive", site: "OneDrive", kind: k?.kind ?? "file", what, name: file ?? fallback, fromAddress: !!file };
  }
  if (host.endsWith(".sharepoint.com")) {
    const site = host.includes("-my.sharepoint.com") ? "OneDrive" : "SharePoint";
    const m = u.pathname.match(/^\/:([a-z]):\//i);
    const k = m ? MS_KIND[m[1].toLowerCase()] : null;
    // A folder link often ends with the folder's own name.
    const parts = u.pathname.split("/").filter(Boolean);
    let last = parts[parts.length - 1] ?? "";
    try {
      last = decodeURIComponent(last);
    } catch {
      /* keep it */
    }
    const folderName = k?.kind === "folder" && last && !/^[A-Za-z0-9_-]{20,}$/.test(last) && !/^:[a-z]:$/i.test(last) ? last : null;
    const what = k?.what ?? whatForName(file, "Link");
    return {
      provider: "onedrive",
      site,
      kind: k?.kind ?? "file",
      what,
      name: file ?? folderName ?? (k?.kind === "folder" ? `${site} folder` : what === "Link" ? `${site} link` : `${what} on ${site}`),
      fromAddress: !!(file ?? folderName),
    };
  }

  let site = host;
  let kind: "folder" | "file" = "file";
  let what = whatForName(file, "Link");
  if (host === "dropbox.com" || host.endsWith(".dropbox.com") || host === "db.tt") {
    site = "Dropbox";
    if (/^\/(scl\/fo|sh)\//.test(u.pathname)) {
      kind = "folder";
      what = "Folder";
    }
  } else if (host === "wetransfer.com" || host.endsWith(".wetransfer.com") || host === "we.tl") {
    site = "WeTransfer";
    what = "Files";
  } else if (host === "box.com" || host.endsWith(".box.com")) {
    site = "Box";
  } else if (host === "icloud.com" || host.endsWith(".icloud.com")) {
    site = "iCloud";
  }
  return { provider: "web", site, kind, what, name: file ?? (what === "Link" ? site : `${what} on ${site}`), fromAddress: !!file };
}

/** How the card describes a saved link: "Excel file on OneDrive", "Folder on Dropbox", "example.com". */
export function linkMeta(l: { kind: string; site?: string | null; title: string; url: string; mime?: string | null }) {
  const site = l.site ?? "";
  let what: string;
  try {
    what = describeLink(l.url).what;
  } catch {
    what = "Link";
  }
  if (what === "Link") return site || "Link";
  return site ? `${what} on ${site}` : what;
}

/** The card's look for each kind of link. */
export function linkBrand(site: string | null | undefined): { color: string; label: string } {
  switch (site) {
    case "OneDrive":
      return { color: "#0364B8", label: "OneDrive" };
    case "SharePoint":
      return { color: "#038387", label: "SharePoint" };
    case "Dropbox":
      return { color: "#0061FF", label: "Dropbox" };
    case "WeTransfer":
      return { color: "#409FFF", label: "WeTransfer" };
    case "Box":
      return { color: "#0061D5", label: "Box" };
    case "iCloud":
      return { color: "#3693F3", label: "iCloud" };
    default:
      return { color: "#5B6B82", label: site || "Website" };
  }
}

/** A checked, ready-to-save link for anything that isn't Google Drive. */
export async function checkOtherLink(url: string): Promise<LinkInfo> {
  const d = describeLink(url);
  let title: string | null = null;
  try {
    title = (await driveCall<{ title: string | null }>("web_info", { url })).title;
  } catch {
    title = null;
  }
  return {
    provider: d.provider,
    site: d.site,
    kind: d.kind,
    // The file name in the address beats a page title; otherwise the page's own title.
    title: (d.fromAddress ? d.name : title || d.name).slice(0, 200),
    drive_id: url,
    resource_key: null,
    mime: null,
    size: null,
  };
}
