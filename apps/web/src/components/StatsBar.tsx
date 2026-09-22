import { useStore } from "../store.ts";
import { hostStyle as hostColour } from "../lib/hostColour.ts";

/**
 * Per-host counts: what is running now, and what exists but is not.
 *
 * "Active" is a live Claude process reported by `claude agents --json`.
 * "Inactive" is historical transcripts minus live, i.e. sessions you could
 * resume but are not running. Historical is only known once the transcript
 * index has been populated, so it shows a dash rather than a wrong zero
 * until then.
 */
export function StatsBar() {
  const tallies = useStore((s) => s.hostTallies);
  const terminals = useStore((s) => s.totals?.terminals ?? 0);
  const setView = useStore((s) => s.setView);

  if (!tallies || tallies.length === 0) return null;

  return (
    <div style={bar}>
      <span style={{ color: "#6a6a73" }}>
        {terminals} terminal{terminals === 1 ? "" : "s"} open
      </span>
      {tallies.map((t) => {
        const active = t.interactive + t.background;
        return (
          <span key={t.host} style={group}>
            <span style={{ ...hostTag, ...hostColour(t.host) }}>{t.host}</span>
            {/* Terminals and Claude sessions are different things: a terminal
                with no Claude in it is open but not "active". Showing both
                stops "3 terminals, 1 active" from looking like a bug. */}
            <Stat
              label="terminals"
              value={t.terminals}
              title="Terminals this viewer has open on the host"
            />
            <Stat
              label="claude"
              value={active}
              tone={active ? "#7fd28c" : undefined}
              title="Live Claude sessions on the host, including ones started outside the viewer"
            />
            {t.background > 0 && <Stat label="background" value={t.background} />}
            {t.waiting > 0 && (
              <Stat label="waiting" value={t.waiting} tone="#e0a33e" />
            )}
            {t.working > 0 && <Stat label="working" value={t.working} tone="#5b8cff" />}
            <Stat
              label="inactive"
              value={t.inactive}
              title="Past sessions with no live process. Click to browse them."
              onClick={() => setView("history")}
            />
            {t.error && (
              <span style={{ color: "#e0a33e" }} title={t.error}>
                unreachable
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  title,
  onClick,
}: {
  label: string;
  value?: number;
  tone?: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <span
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        gap: 4,
        alignItems: "baseline",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <strong style={{ color: tone ?? "#c3c3cb", fontVariantNumeric: "tabular-nums" }}>
        {value === undefined ? "–" : value}
      </strong>
      <span style={{ color: "#6a6a73" }}>{label}</span>
    </span>
  );
}

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "5px 12px",
  borderBottom: "1px solid #1c1c22",
  background: "#0e0e11",
  fontSize: 11,
  flexWrap: "wrap",
};

const group: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
};

const hostTag: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid",
};
