import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostId } from "@cv/shared";
import { STATE_DIR } from "./config.ts";

/**
 * Named session graphs that can be re-deployed.
 *
 * A preset stores what to spawn and how to wire it, not live ids: session ids
 * are minted fresh on every deploy, so edges are recorded as indices into the
 * node list and resolved after the sessions exist.
 *
 * Paths are absolute and host-qualified, which is concrete and matches how
 * fire actually is. Making presets portable across hosts later means adding a
 * field, not reworking the shape.
 */
export interface PresetNode {
  host: HostId;
  cwd: string;
  /** Owner-facing label, also used as the terminal alias. */
  label: string;
  /** Start Claude in this terminal, rather than leaving a shell. */
  claude: boolean;
}

export interface PresetEdge {
  /** Indices into nodes: the target may refer to the source. */
  from: number;
  to: number;
}

/**
 * A frame in a saved graph.
 *
 * Members are indices into the node list, exactly like edges: session ids are
 * minted fresh on every deploy, so storing them would restore nothing.
 */
export interface PresetGroup {
  name: string;
  hue: number;
  members: number[];
}

/**
 * A markdown note on the canvas. Decoration only: it holds no session, so it
 * spawns nothing on deploy and can never be the end of a context link.
 */
export interface PresetNote {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_NOTES = 50;
const MAX_NOTE_CHARS = 20_000;

/** Keep only well-formed notes, so a client or a hand-edited file cannot store nonsense. */
export function cleanNotes(raw: unknown): PresetNote[] {
  if (!Array.isArray(raw)) return [];
  const out: PresetNote[] = [];
  for (const n of raw.slice(0, MAX_NOTES) as Record<string, unknown>[]) {
    const [x, y, w, h] = [n?.x, n?.y, n?.w, n?.h].map(Number);
    if (typeof n?.text !== "string" || ![x, y, w, h].every(Number.isFinite)) continue;
    out.push({ text: n.text.slice(0, MAX_NOTE_CHARS), x: x!, y: y!, w: w!, h: h! });
  }
  return out;
}

export interface Preset {
  name: string;
  description?: string;
  nodes: PresetNode[];
  edges: PresetEdge[];
  groups?: PresetGroup[];
  notes?: PresetNote[];
  builtIn?: boolean;
  savedAt?: number;
}

const FILE = join(STATE_DIR, "presets.json");

const FIRE = "fire" as HostId;
const R = "/home/vishal.gattani/repos";
const CONTROLLERS = [
  "node-control",
  "package-control",
  "safety-system",
  "linear-generator",
  "generator-system-simulation",
];

/** vault -> virtual-generator -> the five controllers it integrates. */
function milIntegration(): Preset {
  const nodes: PresetNode[] = [
    { host: FIRE, cwd: "/home/vishal.gattani/vault", label: "vault", claude: true },
    { host: FIRE, cwd: `${R}/virtual-generator`, label: "virtual-generator", claude: true },
    ...CONTROLLERS.map((r) => ({
      host: FIRE,
      cwd: `${R}/${r}`,
      label: r,
      claude: true,
    })),
  ];
  // vault feeds virtual-generator; virtual-generator feeds each controller.
  const edges: PresetEdge[] = [
    { from: 0, to: 1 },
    ...CONTROLLERS.map((_, i) => ({ from: 1, to: i + 2 })),
  ];
  return {
    name: "mil-integration",
    description:
      "vault to virtual-generator to the five controller repos it integrates for MIL",
    nodes,
    edges,
    builtIn: true,
  };
}

/** vault -> mil-integration-testing -> virtual-generator -> the five. */
function milIntegrationTesting(): Preset {
  const nodes: PresetNode[] = [
    { host: FIRE, cwd: "/home/vishal.gattani/vault", label: "vault", claude: true },
    {
      host: FIRE,
      cwd: `${R}/mil-integration-testing`,
      label: "mil-integration-testing",
      claude: true,
    },
    { host: FIRE, cwd: `${R}/virtual-generator`, label: "virtual-generator", claude: true },
    ...CONTROLLERS.map((r) => ({
      host: FIRE,
      cwd: `${R}/${r}`,
      label: r,
      claude: true,
    })),
  ];
  const edges: PresetEdge[] = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    ...CONTROLLERS.map((_, i) => ({ from: 2, to: i + 3 })),
  ];
  return {
    name: "mil-integration-testing",
    description:
      "vault to the integration test repo, then virtual-generator and the five controllers its CI drives",
    nodes,
    edges,
    builtIn: true,
  };
}

const BUILT_IN = [milIntegration(), milIntegrationTesting()];

export class PresetStore {
  private saved: Preset[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(FILE)) {
        this.saved = JSON.parse(readFileSync(FILE, "utf8")) as Preset[];
      }
    } catch {
      // A corrupt file must not stop the server: the built-ins still work.
      this.saved = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(FILE), { recursive: true });
    // Write then rename, so a crash mid-write cannot truncate the file.
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.saved, null, 2));
    renameSync(tmp, FILE);
  }

  list(): Preset[] {
    return [...BUILT_IN, ...this.saved];
  }

  get(name: string): Preset | undefined {
    return this.list().find((p) => p.name === name);
  }

  save(preset: Preset): Preset[] {
    if (BUILT_IN.some((b) => b.name === preset.name)) {
      throw new Error(`"${preset.name}" is a built-in preset; pick another name`);
    }
    const next = { ...preset, builtIn: false, savedAt: Date.now() };
    const at = this.saved.findIndex((p) => p.name === preset.name);
    if (at >= 0) this.saved[at] = next;
    else this.saved.push(next);
    this.persist();
    return this.list();
  }

  remove(name: string): Preset[] {
    this.saved = this.saved.filter((p) => p.name !== name);
    this.persist();
    return this.list();
  }
}
