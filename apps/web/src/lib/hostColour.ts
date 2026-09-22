import { LOCAL_HOST_ID, type HostId } from "@cv/shared";

/**
 * One colour per host, so two terminals in identically named directories on
 * different machines never look alike.
 *
 * This used to be five byte-identical copies of `host === "fire" ? amber :
 * green`, which is why a second remote would have rendered in local's green and
 * read as a local terminal.
 */
export interface HostPalette {
  bg: string;
  fg: string;
  border: string;
}

/** There is exactly one local host, and it is always this green. */
const LOCAL: HostPalette = { bg: "#16251a", fg: "#7fd28c", border: "#2c4230" };

/**
 * Remote palettes. Every entry is legible on the canvas's near-black and
 * distinguishable from the others without relying on hue alone being noticed —
 * the host name is always printed next to the colour.
 */
const REMOTE: HostPalette[] = [
  { bg: "#2a1c16", fg: "#e2a06a", border: "#4a3122" }, // amber
  { bg: "#151f2b", fg: "#6db4e8", border: "#27415a" }, // blue
  { bg: "#241a2b", fg: "#c08ae0", border: "#3f2d4c" }, // violet
  { bg: "#2b1a1c", fg: "#e08a95", border: "#4c2d33" }, // rose
  { bg: "#16272a", fg: "#6fcfc8", border: "#2a474a" }, // teal
];
// Five, not six. An olive entry was dropped after seeing it next to amber on
// the canvas: close enough to read as "the same host, maybe" at a glance, which
// is the one thing this must never do. Fewer, clearly separated colours beat
// more that collide — a sixth host reuses a colour, and the name disambiguates.

/**
 * "fire" keeps the amber it has always had, rather than whatever the hash would
 * have given it. Its colour is in screenshots, in muscle memory and in
 * docs/plan; changing it to prove a point would be a gratuitous change.
 */
const PINNED: Record<string, number> = { fire: 0 };

/**
 * Stable per id, and stable across reloads and restarts, because it is computed
 * from the id rather than from the order hosts happened to be configured or
 * discovered in. Two hosts can collide onto one colour; the name beside it is
 * what actually identifies the host.
 */
function paletteIndex(host: HostId): number {
  const pinned = PINNED[host];
  if (pinned !== undefined) return pinned;
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) | 0;
  // Skip the pinned slots so an unpinned host never borrows a pinned colour.
  const taken = Object.values(PINNED).length;
  const free = REMOTE.length - taken;
  return taken + (Math.abs(h) % free);
}

export function hostPalette(host: HostId): HostPalette {
  if (host === LOCAL_HOST_ID) return LOCAL;
  return REMOTE[paletteIndex(host)] ?? LOCAL;
}

/** The same colours as the inline style a host pill or badge wants. */
export function hostStyle(host: HostId): {
  background: string;
  color: string;
  borderColor: string;
} {
  const p = hostPalette(host);
  return { background: p.bg, color: p.fg, borderColor: p.border };
}
