import { useStore } from "../store.ts";

const DOT: Record<string, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
  grey: "⚪",
};

/**
 * The fire instance light.
 *
 * Emoji plus text, never colour alone. Grey is a real state, not an error:
 * fire-control is intranet-only, so "cannot see" must not read as "stopped".
 */
export function InstanceLight() {
  const instance = useStore((s) => s.instance);
  const startInstance = useStore((s) => s.startInstance);
  const starting = useStore((s) => s.startingInstance);

  if (!instance) return null;
  const dot = DOT[instance.light] ?? "⚪";
  const canStart = instance.light === "red";

  const detail =
    instance.light === "yellow" && instance.state === "running"
      ? "running, SSH not up yet"
      : instance.state;

  return (
    <span style={wrap} title={`fire: ${detail}`}>
      <span style={{ fontSize: 11 }}>{dot}</span>
      <span style={{ color: "#c3c3cb" }}>fire</span>
      <span style={{ color: "#80808a" }}>{detail}</span>
      {canStart && (
        <button
          style={startButton}
          onClick={() => void startInstance()}
          disabled={starting}
        >
          {starting ? "starting…" : "Start"}
        </button>
      )}
    </span>
  );
}

const wrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  padding: "3px 8px",
  borderRadius: 999,
  background: "#15151a",
  border: "1px solid #2a2a32",
  whiteSpace: "nowrap",
};

const startButton: React.CSSProperties = {
  background: "#1d2b3f",
  border: "1px solid #2f4a6b",
  color: "#8fc0f0",
  borderRadius: 4,
  padding: "1px 7px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10.5,
};
