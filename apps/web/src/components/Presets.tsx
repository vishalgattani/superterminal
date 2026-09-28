import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { PresetDiagram, toPlantUml } from "./PresetDiagram.tsx";
import { hostStyle as hostColour } from "../lib/hostColour.ts";

interface PresetNode {
  host: string;
  cwd: string;
  label: string;
  claude: boolean;
}
interface Preset {
  name: string;
  description?: string;
  nodes: PresetNode[];
  edges: { from: number; to: number }[];
  groups?: { name: string; hue: number; members: number[] }[];
  builtIn?: boolean;
  savedAt?: number;
}

const short = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

/**
 * Saved session graphs: view one, deploy it, or snapshot the current canvas.
 *
 * A deploy spawns every node and recreates every edge, so a workflow that
 * takes eight terminals and seven connections by hand becomes one button.
 */
export function Presets({ onClose }: { onClose: () => void }) {
  const token = useStore((s) => s.token);
  const activeGroups = useStore((s) => s.activeGroups);
  const adoptDeployed = useStore((s) => s.adoptDeployed);
  const activeMembers = useStore((s) => s.activeMembers);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [dir, setDir] = useState<"LR" | "TD">("LR");
  const [showText, setShowText] = useState<"none" | "puml" | "json">("none");

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/presets", { headers: auth });
      const body = await res.json();
      setPresets(body.presets ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const deploy = async (p: Preset) => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/presets/${encodeURIComponent(p.name)}/deploy`, {
        method: "POST",
        headers: auth,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      // Deploying opens a view holding exactly what it spawned, so the result
      // is one workflow on screen, not a few more nodes among everything else.
      if (Array.isArray(body.sessions) && body.sessions.length > 0) {
        adoptDeployed(
          p.name,
          body.sessions,
          Array.isArray(body.groups) ? body.groups : [],
          Array.isArray(body.notes) ? body.notes : [],
        );
      }
      const failed = (body.failed ?? []) as { label: string; error: string }[];
      const notStarted = (body.notStarted ?? []) as { label: string; hint: string }[];
      setNote(
        `Deployed ${p.name}: ${body.spawned} terminals, ` +
          `${body.claudeStarted}/${body.claudeExpected} Claude sessions, ` +
          `${body.wired} connections.` +
          (failed.length
            ? ` Failed: ${failed.map((f) => `${f.label} (${f.error})`).join(", ")}.`
            : "") +
          (notStarted.length
            ? ` Waiting at a prompt: ${notStarted.map((n) => n.label).join(", ")} — open those terminals and answer.`
            : ""),
      );
      // Sessions and links arrive on the next status poll, so the canvas
      // fills in on its own.
      if (failed.length === 0 && notStarted.length === 0) setTimeout(onClose, 1400);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const snapshot = async () => {
    if (!saveName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        // The view's sessions, so a subset saves as a subset from here too.
        body: JSON.stringify({
          name: saveName.trim(),
          groups: activeGroups(),
          members: activeMembers(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setPresets(body.presets ?? []);
      setNote(`Saved "${saveName.trim()}" from the current view.`);
      setSaveName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Download a preset as a .json file. */
  const exportPreset = (p: Preset) => {
    const blob = new Blob([JSON.stringify(p, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name}.preset.json`;
    a.click();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const importPreset = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch("/api/presets/import", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setPresets(body.presets ?? []);
      setNote(`Imported "${body.imported}".`);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Preset) => {
    const res = await fetch(`/api/presets/${encodeURIComponent(p.name)}`, {
      method: "DELETE",
      headers: auth,
    });
    const body = await res.json();
    setPresets(body.presets ?? []);
    if (selected?.name === p.name) setSelected(null);
  };

  return (
    <div style={backdrop} onMouseDown={onClose}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={head}>
          <strong style={{ fontSize: 14 }}>Workflow presets</strong>
          <span style={{ flex: 1 }} />
          <button style={btn} onClick={onClose}>
            Close
          </button>
        </div>

        {note && <p style={{ ...msg, color: "#8fd0a0" }}>{note}</p>}
        {error && <p style={{ ...msg, color: "#e0a33e" }}>{error}</p>}

        <div style={body}>
          <div style={listCol}>
            {presets.map((p) => (
              <article
                key={p.name}
                onClick={() => setSelected(p)}
                style={{
                  ...card,
                  borderColor: selected?.name === p.name ? "#5b8cff" : "#24242a",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <strong style={{ fontSize: 12.5, flex: 1 }}>{p.name}</strong>
                  {p.builtIn && <span style={tag}>built in</span>}
                </div>
                <div style={{ fontSize: 11, color: "#9a9aa3" }}>
                  {p.nodes.length} sessions · {p.edges.length} connections
                  {p.groups?.length ? ` · ${p.groups.length} groups` : ""}
                </div>
                {p.description && (
                  <div style={{ fontSize: 10.5, color: "#6a6a73" }}>{p.description}</div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button
                    style={{ ...btn, borderColor: "#2f4a6b", color: "#8fc0f0" }}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deploy(p);
                    }}
                  >
                    {busy ? "deploying…" : "Deploy"}
                  </button>
                  <button
                    style={btn}
                    title="Download this preset as JSON"
                    onClick={(e) => {
                      e.stopPropagation();
                      exportPreset(p);
                    }}
                  >
                    Export
                  </button>
                  {!p.builtIn && (
                    <button
                      style={{ ...btn, color: "#e08a8a" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(p);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </article>
            ))}

            <div style={{ ...card, borderStyle: "dashed" }}>
              <div style={{ fontSize: 11, color: "#9a9aa3" }}>
                Load a preset from disk
              </div>
              <input
                type="file"
                accept="application/json,.json"
                style={{ ...input, fontSize: 10.5 }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importPreset(f);
                  e.target.value = "";
                }}
              />
            </div>

            <div style={{ ...card, borderStyle: "dashed" }}>
              <div style={{ fontSize: 11, color: "#9a9aa3" }}>
                Snapshot the current view
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  style={{ ...input, flex: 1 }}
                  placeholder="preset name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void snapshot()}
                />
                <button style={btn} disabled={busy || !saveName.trim()} onClick={() => void snapshot()}>
                  Save
                </button>
              </div>
            </div>
          </div>

          <div style={detailCol}>
            {!selected && (
              <p style={{ color: "#5c5c65", fontSize: 12 }}>
                Pick a preset to see what it will create.
              </p>
            )}
            {selected && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#c3c3cb" }}>
                    {selected.nodes.length} sessions, {selected.edges.length} connections
                  </span>
                  <span style={{ flex: 1 }} />
                  {(["LR", "TD"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDir(d)}
                      style={{
                        ...btn,
                        background: dir === d ? "#22222c" : "transparent",
                        color: dir === d ? "#e6e6e6" : "#7a7a84",
                      }}
                      title={d === "LR" ? "Left to right" : "Top down"}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                <div style={diagramBox}>
                  <PresetDiagram
                    nodes={selected.nodes}
                    edges={selected.edges}
                    direction={dir}
                  />
                </div>

                <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
                  <button
                    style={btn}
                    onClick={() => setShowText(showText === "puml" ? "none" : "puml")}
                  >
                    PlantUML
                  </button>
                  <button
                    style={btn}
                    onClick={() => setShowText(showText === "json" ? "none" : "json")}
                  >
                    JSON
                  </button>
                  {showText !== "none" && (
                    <button
                      style={btn}
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          showText === "puml"
                            ? toPlantUml(selected.name, selected.nodes, selected.edges, dir)
                            : JSON.stringify(selected, null, 2),
                        )
                      }
                    >
                      Copy
                    </button>
                  )}
                </div>

                {showText !== "none" && (
                  <pre style={code}>
                    {showText === "puml"
                      ? toPlantUml(selected.name, selected.nodes, selected.edges, dir)
                      : JSON.stringify(selected, null, 2)}
                  </pre>
                )}

                {selected.nodes.map((n, i) => {
                  const feeds = selected.edges
                    .filter((e) => e.from === i)
                    .map((e) => selected.nodes[e.to]?.label)
                    .filter(Boolean);
                  return (
                    <div key={i} style={nodeRow}>
                      <span style={{ ...hostTag, ...hostColour(n.host) }}>{n.host}</span>
                      <strong style={{ fontSize: 11.5 }}>{n.label}</strong>
                      <span style={{ fontSize: 10.5, color: "#7a7a84" }}>
                        {short(n.cwd)}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: n.claude ? "#8fd0a0" : "#6a6a73" }}>
                        {n.claude ? "claude" : "shell"}
                      </span>
                      {feeds.length > 0 && (
                        <span style={{ fontSize: 10, color: "#8fc0f0" }}>
                          → {feeds.join(", ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#05050799",
  display: "grid",
  placeItems: "center",
  zIndex: 900,
};
const panel: React.CSSProperties = {
  width: "min(900px, calc(100vw - 40px))",
  maxHeight: "80vh",
  background: "#111113",
  border: "1px solid #2f2f39",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "11px 14px",
  borderBottom: "1px solid #24242a",
};
const body: React.CSSProperties = { display: "flex", minHeight: 0, flex: 1 };
const listCol: React.CSSProperties = {
  width: "min(46%, 380px)",
  borderRight: "1px solid #24242a",
  padding: 10,
  display: "grid",
  gap: 8,
  alignContent: "start",
  overflowY: "auto",
};
const detailCol: React.CSSProperties = { flex: 1, padding: 12, overflowY: "auto" };
const card: React.CSSProperties = {
  border: "1px solid #24242a",
  borderRadius: 9,
  padding: "9px 11px",
  background: "#15151a",
  cursor: "pointer",
  display: "grid",
  gap: 5,
};
const diagramBox: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #24242a",
  borderRadius: 8,
  padding: 8,
  overflowX: "auto",
};
const code: React.CSSProperties = {
  margin: 0,
  background: "#0e0e11",
  border: "1px solid #24242a",
  borderRadius: 8,
  padding: 9,
  fontSize: 10.5,
  lineHeight: 1.45,
  color: "#c3c3cb",
  maxHeight: 220,
  overflow: "auto",
  fontFamily: "ui-monospace, Menlo, monospace",
};
const nodeRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
  borderBottom: "1px solid #1c1c22",
  flexWrap: "wrap",
};
const hostTag: React.CSSProperties = {
  fontSize: 9.5,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid",
};
const tag: React.CSSProperties = {
  fontSize: 9.5,
  color: "#9a9aa3",
  border: "1px solid #33333d",
  borderRadius: 999,
  padding: "0 6px",
};
const btn: React.CSSProperties = {
  background: "#1c1c23",
  border: "1px solid #2f2f39",
  color: "#c9c9d1",
  borderRadius: 5,
  padding: "3px 10px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
};
const input: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #2a2a32",
  color: "#e6e6e6",
  borderRadius: 5,
  padding: "3px 7px",
  font: "inherit",
  fontSize: 11.5,
};
const msg: React.CSSProperties = { margin: 0, padding: "7px 14px", fontSize: 11.5 };
