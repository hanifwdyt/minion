import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

const API = "/api";

type Tab = "minions" | "souls" | "context" | "integrations" | "usage" | "activity" | "proposals";

interface MinionConfig {
  id: string;
  name: string;
  role: string;
  color?: string;
  allowedTools: string;
  maxTurns: number;
  model?: string;
  workdir: string;
  status: string;
}

// --- Auth token management ---
let authToken: string | null = null;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  return headers;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...opts?.headers },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json();
}

// --- Main Dashboard ---
export function Dashboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("minions");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");

  // Check if auth is needed on mount
  useEffect(() => {
    apiFetch("/auth/verify").then(() => setNeedsAuth(false)).catch((e) => {
      if (e.message.includes("401")) setNeedsAuth(true);
    });
  }, []);

  if (needsAuth) {
    return <LoginScreen onLogin={(token) => { authToken = token; setNeedsAuth(false); }} onClose={onClose} />;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "minions", label: "Minions" },
    { id: "souls", label: "Souls" },
    { id: "context", label: "Shared Context" },
    { id: "integrations", label: "Integrations" },
    { id: "usage", label: "Usage" },
    { id: "activity", label: "Activity" },
    { id: "proposals", label: "Proposals" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", justifyContent: "center", alignItems: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dashboard-modal" style={{
        width: "90%", maxWidth: 900, height: "80vh",
        background: "#FFF8F0", borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 24px", background: "#5D4037", color: "#FFE0B2",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 1 }}>
            PUNAKAWAN Dashboard
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.1)", border: "none", color: "#FFE0B2",
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16,
          }}>x</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 0, borderBottom: "2px solid #DAA520",
          background: "#EFEBE9",
        }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setError(""); }} style={{
              padding: "10px 20px", border: "none", cursor: "pointer",
              background: tab === t.id ? "#FFF8F0" : "transparent",
              color: tab === t.id ? "#5D4037" : "#888",
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: 13, borderBottom: tab === t.id ? "2px solid #DAA520" : "2px solid transparent",
              fontFamily: "'Inter', sans-serif",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "8px 24px", background: "#FFF0F0", color: "#E53935",
            fontSize: 12, borderBottom: "1px solid #FFCDD2",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>{error}</span>
            <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "#E53935", cursor: "pointer" }}>x</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {tab === "minions" && <MinionsTab onError={setError} />}
          {tab === "souls" && <SoulsTab onError={setError} />}
          {tab === "context" && <ContextTab onError={setError} />}
          {tab === "integrations" && <IntegrationsTab onError={setError} />}
          {tab === "usage" && <UsageTab />}
          {tab === "activity" && <ActivityTab />}
          {tab === "proposals" && <ProposalsTab />}
        </div>
      </div>
    </div>
  );
}

// --- Login Screen ---
function LoginScreen({ onLogin, onClose }: { onLogin: (token: string) => void; onClose: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      const data = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      }).then((r) => {
        if (!r.ok) throw new Error("Invalid credentials");
        return r.json();
      });
      onLogin(data.token);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", justifyContent: "center", alignItems: "center",
    }}>
      <div style={{
        width: 360, background: "#FFF8F0", borderRadius: 16, padding: 32,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#5D4037", marginBottom: 20, textAlign: "center" }}>
          PUNAKAWAN Login
        </div>
        {error && <div style={{ color: "#E53935", fontSize: 12, marginBottom: 12, textAlign: "center" }}>{error}</div>}
        <Field label="Username" value={user} onChange={setUser} />
        <div style={{ height: 8 }} />
        <Field label="Password" value={pass} onChange={setPass} type="password" />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleLogin} style={{ ...btnStyle("#5D4037"), flex: 1, padding: "10px 0" }}>Login</button>
          <button onClick={onClose} style={{ ...btnStyle("#999"), padding: "10px 16px" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// --- Minions Tab ---
function MinionsTab({ onError }: { onError: (msg: string) => void }) {
  const [minions, setMinions] = useState<MinionConfig[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MinionConfig>>({});

  const load = useCallback(() => {
    apiFetch("/minions").then(setMinions).catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (id: string) => {
    if (!form.allowedTools?.trim()) { onError("allowedTools cannot be empty"); return; }
    if (!form.maxTurns || form.maxTurns < 1) { onError("maxTurns must be >= 1"); return; }
    try {
      await apiFetch(`/minions/${id}`, { method: "PUT", body: JSON.stringify(form) });
      load();
      setEditing(null);
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {minions.map((m) => (
        <div key={m.id} style={{
          background: "#FFF", borderRadius: 12, padding: 16,
          border: `2px solid ${editing === m.id ? "#DAA520" : "#E0E0E0"}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: m.color || "#888",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "white", fontWeight: 800, fontSize: 13,
              }}>{m.name?.[0] || "?"}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{m.role} · {m.status}</div>
              </div>
            </div>
            {editing === m.id ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => save(m.id)} style={btnStyle("#4CAF50")}>Save</button>
                <button onClick={() => setEditing(null)} style={btnStyle("#999")}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setEditing(m.id); setForm(m); }} style={btnStyle("#5D4037")}>Edit</button>
            )}
          </div>

          {editing === m.id && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Allowed Tools" value={form.allowedTools || ""} onChange={(v) => setForm({ ...form, allowedTools: v })} />
              <Field label="Max Turns" value={String(form.maxTurns || "")} onChange={(v) => setForm({ ...form, maxTurns: Number(v) || 1 })} />
              <Field label="Model" value={form.model || ""} onChange={(v) => setForm({ ...form, model: v })} placeholder="e.g. claude-sonnet-4-6" />
              <Field label="Workdir" value={form.workdir || ""} onChange={(v) => setForm({ ...form, workdir: v })} />
            </div>
          )}

          {editing !== m.id && (
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#888", flexWrap: "wrap" }}>
              <span>Tools: <code>{m.allowedTools}</code></span>
              <span>Turns: {m.maxTurns}</span>
              <span>Model: {m.model || "default"}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Souls Tab ---
function SoulsTab({ onError }: { onError: (msg: string) => void }) {
  const [minions, setMinions] = useState<MinionConfig[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);
  const loadingRef = useRef(0);

  useEffect(() => {
    apiFetch("/minions").then((list) => {
      setMinions(list);
      if (list.length > 0) setSelected(list[0].id);
    }).catch((e) => onError(e.message));
  }, [onError]);

  // Load soul when selected changes (fixes race condition)
  useEffect(() => {
    if (!selected) return;
    const reqId = ++loadingRef.current;
    apiFetch(`/souls/${selected}`).then((data) => {
      if (reqId === loadingRef.current) {
        setContent(data.content || "");
        setSaved(false);
      }
    }).catch((e) => onError(e.message));
  }, [selected, onError]);

  const saveSoul = async () => {
    try {
      await apiFetch(`/souls/${selected}`, { method: "PUT", body: JSON.stringify({ content }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {minions.map((m) => (
          <button key={m.id} onClick={() => setSelected(m.id)}
            style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              background: selected === m.id ? "#5D4037" : "#E0E0E0",
              color: selected === m.id ? "#FFE0B2" : "#666",
              fontWeight: 600, fontSize: 13,
            }}>{m.name}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={saveSoul} style={btnStyle(saved ? "#4CAF50" : "#DAA520")}>
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)}
        style={{
          flex: 1, minHeight: 300, background: "#FFF", border: "1px solid #E0E0E0",
          borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', monospace", resize: "none", outline: "none",
        }} />
    </div>
  );
}

// --- Shared Context Tab ---
function ContextTab({ onError }: { onError: (msg: string) => void }) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/shared-context").then((d) => setContent(d.content || "")).catch((e) => onError(e.message));
  }, [onError]);

  const save = async () => {
    try {
      await apiFetch("/shared-context", { method: "PUT", body: JSON.stringify({ content }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Shared Context</div>
          <div style={{ fontSize: 12, color: "#888" }}>Injected into every minion's system prompt</div>
        </div>
        <button onClick={save} style={btnStyle(saved ? "#4CAF50" : "#DAA520")}>
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)}
        style={{
          flex: 1, minHeight: 300, background: "#FFF", border: "1px solid #E0E0E0",
          borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', monospace", resize: "none", outline: "none",
        }} />
    </div>
  );
}

// --- Integrations Tab ---
function IntegrationsTab({ onError }: { onError: (msg: string) => void }) {
  const [config, setConfig] = useState<any>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/integrations").then(setConfig).catch((e) => onError(e.message));
  }, [onError]);

  const save = async () => {
    try {
      await apiFetch("/integrations", { method: "PUT", body: JSON.stringify(config) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { onError(e.message); }
  };

  const updateField = (section: string, field: string, value: any) => {
    setConfig({ ...config, [section]: { ...config[section], [field]: value } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Telegram Bot">
        <Toggle label="Enabled" value={config.telegram?.enabled} onChange={(v) => updateField("telegram", "enabled", v)} />
        <Field label="Bot Token" value={config.telegram?.token || ""} onChange={(v) => updateField("telegram", "token", v)} placeholder="123456:ABC-DEF..." type="password" />
      </Section>

      <Section title="Slack Bot">
        <Toggle label="Enabled" value={config.slack?.enabled} onChange={(v) => updateField("slack", "enabled", v)} />
        <Field label="Bot Token" value={config.slack?.botToken || ""} onChange={(v) => updateField("slack", "botToken", v)} placeholder="xoxb-..." type="password" />
        <Field label="Signing Secret" value={config.slack?.signingSecret || ""} onChange={(v) => updateField("slack", "signingSecret", v)} type="password" />
        <Field label="App Token" value={config.slack?.appToken || ""} onChange={(v) => updateField("slack", "appToken", v)} placeholder="xapp-..." type="password" />
      </Section>

      <Section title="Webhook">
        <Toggle label="Enabled" value={config.webhook?.enabled} onChange={(v) => updateField("webhook", "enabled", v)} />
        <Field label="Secret" value={config.webhook?.secret || ""} onChange={(v) => updateField("webhook", "secret", v)} type="password" />
      </Section>

      <button onClick={save} style={{ ...btnStyle(saved ? "#4CAF50" : "#DAA520"), alignSelf: "flex-end" }}>
        {saved ? "Saved!" : "Save All"}
      </button>
    </div>
  );
}

// --- Usage Tab ---
function UsageTab() {
  const [usage, setUsage] = useState<any>({});

  useEffect(() => {
    const load = () => apiFetch("/usage").then(setUsage).catch(() => {});
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16 }}>
        <StatCard label="Total Input Tokens" value={usage.totalInputTokens || 0} />
        <StatCard label="Total Output Tokens" value={usage.totalOutputTokens || 0} />
      </div>

      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8 }}>Per Minion</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {Object.entries(usage.byMinion || {}).map(([id, stats]: [string, any]) => (
          <div key={id} style={{
            background: "#FFF", borderRadius: 8, padding: 14, border: "1px solid #E0E0E0",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{id}</div>
            <div style={{ fontSize: 12, color: "#666", display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Prompts: {stats.prompts}</span>
              <span>Input: {stats.inputTokens?.toLocaleString()} tokens</span>
              <span>Output: {stats.outputTokens?.toLocaleString()} tokens</span>
            </div>
          </div>
        ))}
      </div>
      {Object.keys(usage.byMinion || {}).length === 0 && (
        <div style={{ color: "#999", textAlign: "center", padding: 40 }}>No usage data yet</div>
      )}
    </div>
  );
}

// --- Activity Tab ---
function ActivityTab() {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const load = () => apiFetch("/activity?limit=100").then(setEvents).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {events.length === 0 && <div style={{ color: "#999", textAlign: "center", padding: 40 }}>No activity yet</div>}
      {events.map((e) => (
        <div key={e.id} style={{
          display: "flex", gap: 10, padding: "6px 0", fontSize: 12,
          borderBottom: "1px solid #F0F0F0",
        }}>
          <span style={{ color: "#999", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
            {new Date(e.timestamp).toLocaleTimeString()}
          </span>
          <span style={{ fontWeight: 600, color: "#5D4037", flexShrink: 0 }}>{e.minionName}</span>
          <span style={{ color: "#666" }}>{e.summary}</span>
        </div>
      ))}
    </div>
  );
}

// --- Proposals Tab ---
function ProposalsTab() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch("/proposals").then(setProposals).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  const handleAction = async (id: string, action: "approve" | "reject" | "done") => {
    setLoading(id);
    try {
      await apiFetch(`/proposals/${id}/${action}`, { method: "POST" });
      load();
    } catch {}
    setLoading(null);
  };

  const priorityColor: Record<string, string> = {
    high: "#D32F2F",
    medium: "#F57C00",
    low: "#388E3C",
  };

  const statusIcon: Record<string, string> = {
    pending: "⏳",
    approved: "✅",
    rejected: "❌",
    done: "✔️",
  };

  const pending = proposals.filter((p) => p.status === "pending");
  const others = proposals.filter((p) => p.status !== "pending" && p.id !== "init");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Pending proposals */}
      {pending.length === 0 && others.length === 0 && (
        <div style={{ color: "#999", textAlign: "center", padding: 40 }}>
          No proposals yet. Breath system will generate improvement proposals overnight (9PM-6AM).
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#5D4037", marginBottom: 4 }}>
          Pending Approval ({pending.length})
        </div>
      )}

      {pending.map((p) => (
        <div key={p.id} style={{
          border: "2px solid #FFE0B2", borderRadius: 10, overflow: "hidden",
          background: "#FFFAF5",
        }}>
          <div
            style={{
              padding: "12px 16px", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
            onClick={() => setExpanded(expanded === p.id ? null : p.id)}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                background: priorityColor[p.priority] || "#999", color: "white",
                textTransform: "uppercase",
              }}>
                {p.priority || "medium"}
              </span>
              <span style={{ fontSize: 11, color: "#999", background: "#F0F0F0", padding: "2px 6px", borderRadius: 4 }}>
                {p.category || "general"}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.title}</span>
            </div>
            <span style={{ fontSize: 16 }}>{expanded === p.id ? "▲" : "▼"}</span>
          </div>

          {expanded === p.id && (
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{
                fontSize: 12, color: "#555", whiteSpace: "pre-wrap",
                background: "#FFF", padding: 12, borderRadius: 8, marginBottom: 12,
                border: "1px solid #EEE", lineHeight: 1.6,
              }}>
                {p.description || "No description"}
              </div>

              {p.estimatedImpact && (
                <div style={{ fontSize: 11, color: "#388E3C", marginBottom: 12 }}>
                  Expected impact: {p.estimatedImpact}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleAction(p.id, "approve")}
                  disabled={loading === p.id}
                  style={{
                    padding: "8px 20px", borderRadius: 6, border: "none",
                    background: "#388E3C", color: "white", fontWeight: 600,
                    cursor: "pointer", fontSize: 12,
                  }}
                >
                  {loading === p.id ? "Executing..." : "Approve & Execute"}
                </button>
                <button
                  onClick={() => handleAction(p.id, "reject")}
                  disabled={loading === p.id}
                  style={{
                    padding: "8px 20px", borderRadius: 6,
                    border: "1px solid #DDD", background: "white", color: "#999",
                    cursor: "pointer", fontSize: 12,
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Completed proposals */}
      {others.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#999", marginTop: 8 }}>
            History
          </div>
          {others.map((p) => (
            <div key={p.id} style={{
              padding: "8px 16px", borderRadius: 8, background: "#F5F5F5",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              opacity: 0.7,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>{statusIcon[p.status] || ""}</span>
                <span style={{ fontSize: 12 }}>{p.title}</span>
              </div>
              <span style={{ fontSize: 10, color: "#999" }}>{p.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// --- Shared UI components ---
function Field({ label, value, onChange, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} type={type || "text"}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 6,
          border: "1px solid #E0E0E0", fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace", outline: "none",
          boxSizing: "border-box",
        }} />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div onClick={() => onChange(!value)} style={{
        width: 36, height: 20, borderRadius: 10,
        background: value ? "#4CAF50" : "#CCC", cursor: "pointer",
        position: "relative", transition: "background 0.2s",
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%", background: "#FFF",
          position: "absolute", top: 2,
          left: value ? 18 : 2, transition: "left 0.2s",
        }} />
      </div>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#FFF", borderRadius: 12, padding: 16, border: "1px solid #E0E0E0" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      flex: 1, background: "#FFF", borderRadius: 12, padding: 16,
      border: "1px solid #E0E0E0", textAlign: "center",
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#5D4037" }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: "white", border: "none", borderRadius: 8,
    padding: "6px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12,
  };
}
