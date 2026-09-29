import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store.ts";
import type { HostStatus } from "../store/model.ts";

interface RemoteRow {
  id: string;
  label?: string;
  sshTarget: string;
  keyPath?: string;
  claudePath: string;
  claudeModel?: string;
}

/**
 * Add, and remove, a remote host from the running viewer.
 *
 * The host system itself has always taken any number of remotes from
 * config.env (see config.example.env); this is the other way to declare one,
 * for "I have a second box, let me point at it" without opening a text editor
 * and restarting the server. A host declared in config.env still shows here,
 * read-only, with a note pointing at the file: this panel only owns the ones
 * it added.
 */
export function HostSettings({ onClose }: { onClose: () => void }) {
  const token = useStore((s) => s.token);
  const hosts = useStore((s) => s.hosts);
  const setHosts = useStore((s) => s.setHosts);
  const defaultCwd = useStore((s) => s.defaultCwd);
  const [remotes, setRemotes] = useState<RemoteRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [claudePath, setClaudePath] = useState("");
  const [claudeModel, setClaudeModel] = useState("");
  const [keyType, setKeyType] = useState<"ed25519" | "rsa">("ed25519");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const refresh = useCallback(async () => {
    const [hostsRes, remotesRes] = await Promise.all([
      fetch("/api/hosts", { headers: auth }),
      fetch("/api/hosts/remotes", { headers: auth }),
    ]);
    const hostsBody = await hostsRes.json();
    const remotesBody = await remotesRes.json();
    setHosts(hostsBody.hosts ?? [], hostsBody.defaultCwd ?? defaultCwd);
    setRemotes(remotesBody.remotes ?? []);
  }, [token]);

  useEffect(() => {
    void refresh();
    // Only on open: the picker's own poll keeps `hosts` current afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manageable = new Set(remotes.map((r) => r.id));

  const reset = () => {
    setId("");
    setLabel("");
    setSshTarget("");
    setKeyPath("");
    setClaudePath("");
    setClaudeModel("");
    setPublicKey(null);
    setOpen(false);
  };

  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/hosts/remotes", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          id: id.trim(),
          label: label.trim() || undefined,
          sshTarget: sshTarget.trim(),
          keyPath: keyPath.trim() || undefined,
          claudePath: claudePath.trim() || undefined,
          claudeModel: claudeModel.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      reset();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const generateKey = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ssh/keygen", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: `superterminal_${id.trim()}`, type: keyType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setKeyPath(body.keyPath);
      setPublicKey(body.publicKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (hostId: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/hosts/remotes/${encodeURIComponent(hostId)}`, {
        method: "DELETE",
        headers: auth,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Hosts</strong>
          <span style={{ flex: 1 }} />
          <button style={btn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {hosts
            .filter((h): h is HostStatus & { remote: true } => Boolean(h.remote))
            .map((h) => (
              <div key={h.id} style={row}>
                <span style={{ fontSize: 11.5 }}>
                  {h.label}
                  {!h.available && <span style={{ color: "#e0a33e" }}> — {h.reason}</span>}
                </span>
                <span style={{ flex: 1 }} />
                {manageable.has(h.id) ? (
                  <button style={btnSmall} disabled={busy} onClick={() => void remove(h.id)}>
                    Remove
                  </button>
                ) : (
                  // Every real host is either in this store or in config.env; an
                  // unavailable one (the "nothing configured yet" placeholder) is
                  // neither, and saying "config.env" on it would misname the reason
                  // already shown above in amber.
                  h.available && (
                    <span
                      style={{ fontSize: 10, color: "#6a6a73" }}
                      title="Declared in config.env; edit or remove it there"
                    >
                      config.env
                    </span>
                  )
                )}
              </div>
            ))}
          {hosts.every((h) => !h.remote) && (
            <div style={{ fontSize: 11, color: "#8a8a93" }}>No remote hosts yet.</div>
          )}
        </div>

        {error && <div style={{ fontSize: 11, color: "#e0736b" }}>{error}</div>}

        {!open ? (
          <button style={btn} onClick={() => setOpen(true)}>
            + Add a host
          </button>
        ) : (
          <div style={{ display: "grid", gap: 6, borderTop: "1px solid #2a2a32", paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...input, width: 90 }}
                placeholder="tag (e.g. fire)"
                value={id}
                onChange={(e) => setId(e.target.value)}
                autoFocus
              />
              <input
                style={{ ...input, flex: 1 }}
                placeholder="label (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <input
              style={input}
              placeholder="user@host, or a ~/.ssh/config alias"
              value={sshTarget}
              onChange={(e) => setSshTarget(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...input, flex: 1 }}
                placeholder="SSH key path (optional — falls back to ssh-agent / ~/.ssh/config)"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
              />
              <select
                style={input}
                value={keyType}
                onChange={(e) => setKeyType(e.target.value as "ed25519" | "rsa")}
              >
                <option value="ed25519">ed25519</option>
                <option value="rsa">RSA 4096</option>
              </select>
              <button
                style={btnSmall}
                disabled={busy || !id.trim()}
                title={
                  id.trim()
                    ? `Create ~/.ssh/superterminal_${id.trim()} and use it for this host`
                    : "Enter a tag first; the key is named after it"
                }
                onClick={() => void generateKey()}
              >
                Generate key
              </button>
            </div>
            {publicKey && (
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 11, color: "#8a8a93" }}>
                  Add this public key to ~/.ssh/authorized_keys on the host:
                </div>
                <textarea
                  style={{ ...input, fontFamily: "monospace", height: 56, resize: "none" }}
                  readOnly
                  value={publicKey}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  style={{ ...btnSmall, justifySelf: "start" }}
                  onClick={() => void navigator.clipboard.writeText(publicKey)}
                >
                  Copy public key
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...input, flex: 1 }}
                placeholder="claude path (optional)"
                value={claudePath}
                onChange={(e) => setClaudePath(e.target.value)}
              />
              <input
                style={{ ...input, flex: 1 }}
                placeholder="claude model (optional)"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button style={btnSmall} onClick={reset}>
                Cancel
              </button>
              <button
                style={btn}
                disabled={busy || !id.trim() || !sshTarget.trim()}
                onClick={() => void add()}
              >
                {busy ? "…" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#000000aa",
  display: "grid",
  placeItems: "center",
  zIndex: 40,
};

const panel: React.CSSProperties = {
  width: 380,
  maxHeight: "80vh",
  overflow: "auto",
  background: "#15151a",
  border: "1px solid #2f2f39",
  borderRadius: 10,
  padding: 12,
  display: "grid",
  gap: 10,
  boxShadow: "0 20px 50px #000000cc",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 7px",
  background: "#0e0e11",
  border: "1px solid #2a2a32",
  borderRadius: 6,
};

const btn: React.CSSProperties = {
  background: "#1d1d24",
  border: "1px solid #2f2f39",
  color: "#e6e6e6",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 11.5,
  cursor: "pointer",
};

const btnSmall: React.CSSProperties = {
  ...btn,
  padding: "3px 8px",
  fontSize: 10.5,
};

const input: React.CSSProperties = {
  background: "#0e0e11",
  border: "1px solid #2a2a32",
  color: "#e6e6e6",
  borderRadius: 5,
  padding: "5px 8px",
  font: "inherit",
  fontSize: 11.5,
};
