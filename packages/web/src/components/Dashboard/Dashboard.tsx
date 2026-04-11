import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { colors, fonts, fontSize, radius, spacing, shadows, glass, transition } from "../../styles/tokens";

const API = "/api";

type Tab = "minions" | "souls" | "context" | "integrations" | "usage" | "activity" | "breath";

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

// --- Shared styles ---
const glassInputStyle: CSSProperties = {
  width: "100%",
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderRadius: radius.md,
  ...glass.input,
  color: colors.text,
  fontSize: fontSize.sm,
  fontFamily: fonts.mono,
  outline: "none",
  boxSizing: "border-box",
  transition: `border ${transition.fast}`,
};

const glassInputFocusStyle: CSSProperties = {
  border: `1px solid ${colors.gold}`,
  boxShadow: `0 0 0 2px ${colors.goldGlow}`,
};

function btnStyle(bg: string): CSSProperties {
  return {
    background: bg,
    color: bg === colors.gold || bg === colors.goldBright ? colors.textInverse : "#fff",
    border: "none",
    borderRadius: radius.md,
    padding: `${spacing.sm}px ${spacing.lg}px`,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: fontSize.xs,
    fontFamily: fonts.sans,
    transition: `all ${transition.fast}`,
    letterSpacing: "0.3px",
  };
}

function btnGold(active?: boolean): CSSProperties {
  return {
    ...btnStyle(active ? colors.success : colors.gold),
    color: active ? "#fff" : colors.textInverse,
  };
}

function btnGhost(): CSSProperties {
  return {
    background: "transparent",
    color: colors.textMuted,
    border: `1px solid ${colors.glassBorder}`,
    borderRadius: radius.md,
    padding: `${spacing.sm}px ${spacing.lg}px`,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: fontSize.xs,
    fontFamily: fonts.sans,
    transition: `all ${transition.fast}`,
  };
}

// --- Main Dashboard ---
export function Dashboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("minions");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

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
    { id: "context", label: "Context" },
    { id: "integrations", label: "Integrations" },
    { id: "usage", label: "Usage" },
    { id: "activity", label: "Activity" },
    { id: "breath", label: "Breath" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(10, 8, 6, 0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex", justifyContent: "center", alignItems: "center",
        opacity: mounted ? 1 : 0,
        transition: `opacity ${transition.normal}`,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "90%", maxWidth: 920, height: "80vh",
          ...glass.panel,
          background: colors.glassBg,
          borderRadius: radius.xxl,
          boxShadow: shadows.xl,
          display: "flex", flexDirection: "column", overflow: "hidden",
          transform: mounted ? "scale(1)" : "scale(0.95)",
          opacity: mounted ? 1 : 0,
          transition: `transform ${transition.spring}, opacity ${transition.normal}`,
        }}
      >
        {/* Header */}
        <div style={{
          padding: `${spacing.lg}px ${spacing.xl}px`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: `1px solid ${colors.glassBorder}`,
        }}>
          <div style={{
            fontFamily: fonts.display,
            fontSize: fontSize.xl,
            color: colors.gold,
            letterSpacing: "0.5px",
          }}>
            Punakawan
          </div>
          <button
            onClick={onClose}
            aria-label="Close dashboard"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${colors.glassBorder}`,
              color: colors.textLight,
              borderRadius: radius.md,
              width: 32, height: 32,
              cursor: "pointer",
              fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: `all ${transition.fast}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.text;
              e.currentTarget.style.borderColor = colors.goldBorder;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textLight;
              e.currentTarget.style.borderColor = colors.glassBorder;
            }}
          >
            ×
          </button>
        </div>

        {/* Tab pills */}
        <div style={{
          display: "flex", gap: spacing.xs,
          padding: `${spacing.md}px ${spacing.xl}px`,
          borderBottom: `1px solid ${colors.glassBorder}`,
          overflowX: "auto",
        }}>
          {tabs.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(""); }}
                style={{
                  padding: `${spacing.sm}px ${spacing.lg}px`,
                  borderRadius: radius.full,
                  border: "none",
                  cursor: "pointer",
                  background: isActive ? colors.gold : "transparent",
                  color: isActive ? colors.textInverse : colors.textMuted,
                  fontWeight: isActive ? 700 : 500,
                  fontSize: fontSize.sm,
                  fontFamily: fonts.sans,
                  transition: `all ${transition.fast}`,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = colors.text;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = colors.textMuted;
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: `${spacing.sm}px ${spacing.xl}px`,
            background: colors.errorBg,
            color: colors.error,
            fontSize: fontSize.xs,
            borderBottom: `1px solid ${colors.errorBorder}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontFamily: fonts.mono,
          }}>
            <span>{error}</span>
            <button onClick={() => setError("")} style={{
              background: "none", border: "none", color: colors.error,
              cursor: "pointer", fontSize: 14,
            }}>×</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: spacing.xl }}>
          {tab === "minions" && <MinionsTab onError={setError} />}
          {tab === "souls" && <SoulsTab onError={setError} />}
          {tab === "context" && <ContextTab onError={setError} />}
          {tab === "integrations" && <IntegrationsTab onError={setError} />}
          {tab === "usage" && <UsageTab />}
          {tab === "activity" && <ActivityTab />}
          {tab === "breath" && <BreathTab />}
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

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
      background: "rgba(10, 8, 6, 0.7)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      display: "flex", justifyContent: "center", alignItems: "center",
    }}>
      <div style={{
        width: 380,
        ...glass.panel,
        background: colors.glassBg,
        borderRadius: radius.xxl,
        padding: spacing.xxxl,
        boxShadow: shadows.xl,
        transform: mounted ? "scale(1)" : "scale(0.95)",
        opacity: mounted ? 1 : 0,
        transition: `transform ${transition.spring}, opacity ${transition.normal}`,
      }}>
        <div style={{
          fontFamily: fonts.display,
          fontSize: fontSize.xxl,
          color: colors.gold,
          marginBottom: spacing.xl,
          textAlign: "center",
        }}>
          Punakawan
        </div>
        <div style={{
          fontSize: fontSize.sm,
          color: colors.textMuted,
          textAlign: "center",
          marginBottom: spacing.xl,
          fontFamily: fonts.sans,
        }}>
          Sign in to continue
        </div>
        {error && (
          <div style={{
            color: colors.error,
            fontSize: fontSize.xs,
            marginBottom: spacing.md,
            textAlign: "center",
            fontFamily: fonts.mono,
          }}>
            {error}
          </div>
        )}
        <Field label="Username" value={user} onChange={setUser} />
        <div style={{ height: spacing.md }} />
        <Field label="Password" value={pass} onChange={setPass} type="password" />
        <div style={{ display: "flex", gap: spacing.sm, marginTop: spacing.xl }}>
          <button onClick={handleLogin} style={{ ...btnStyle(colors.gold), flex: 1, padding: `${spacing.md}px 0` }}>
            Login
          </button>
          <button onClick={onClose} style={{ ...btnGhost(), padding: `${spacing.md}px ${spacing.lg}px` }}>
            Cancel
          </button>
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

  const minionColors: Record<string, string> = {
    semar: colors.semar,
    gareng: colors.gareng,
    petruk: colors.petruk,
    bagong: colors.bagong,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      {minions.length === 0 && <EmptyState text="No minions configured" />}
      {minions.map((m) => (
        <div key={m.id} style={{
          ...glass.card,
          borderRadius: radius.lg,
          padding: spacing.lg,
          border: editing === m.id ? `1px solid ${colors.goldBorder}` : `1px solid ${colors.glassBorder}`,
          transition: `border ${transition.fast}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
            <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
              <div style={{
                width: 36, height: 36, borderRadius: radius.full,
                background: minionColors[m.id] || m.color || colors.goldDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 800, fontSize: fontSize.sm,
                fontFamily: fonts.display,
                boxShadow: `0 0 12px ${(minionColors[m.id] || colors.goldDim)}33`,
              }}>
                {m.name?.[0] || "?"}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: fontSize.md, color: colors.text, fontFamily: fonts.sans }}>
                  {m.name}
                </div>
                <div style={{ fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fonts.sans }}>
                  {m.role}
                  <span style={{
                    marginLeft: spacing.sm,
                    padding: `1px ${spacing.sm}px`,
                    borderRadius: radius.full,
                    fontSize: 10,
                    background: m.status === "idle" ? colors.goldGlow : "rgba(90, 158, 111, 0.15)",
                    color: m.status === "idle" ? colors.goldDim : colors.success,
                    fontWeight: 600,
                  }}>
                    {m.status}
                  </span>
                </div>
              </div>
            </div>
            {editing === m.id ? (
              <div style={{ display: "flex", gap: spacing.sm }}>
                <button onClick={() => save(m.id)} style={btnStyle(colors.success)}>Save</button>
                <button onClick={() => setEditing(null)} style={btnGhost()}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setEditing(m.id); setForm(m); }} style={btnGold()}>Edit</button>
            )}
          </div>

          {editing === m.id && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.md }}>
              <Field label="Allowed Tools" value={form.allowedTools || ""} onChange={(v) => setForm({ ...form, allowedTools: v })} />
              <Field label="Max Turns" value={String(form.maxTurns || "")} onChange={(v) => setForm({ ...form, maxTurns: Number(v) || 1 })} />
              <Field label="Model" value={form.model || ""} onChange={(v) => setForm({ ...form, model: v })} placeholder="e.g. claude-sonnet-4-6" />
              <Field label="Workdir" value={form.workdir || ""} onChange={(v) => setForm({ ...form, workdir: v })} />
            </div>
          )}

          {editing !== m.id && (
            <div style={{ display: "flex", gap: spacing.lg, fontSize: fontSize.xs, color: colors.textMuted, flexWrap: "wrap", fontFamily: fonts.mono }}>
              <span>tools: <span style={{ color: colors.textSecondary }}>{m.allowedTools}</span></span>
              <span>turns: <span style={{ color: colors.textSecondary }}>{m.maxTurns}</span></span>
              <span>model: <span style={{ color: colors.textSecondary }}>{m.model || "default"}</span></span>
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

  const minionColors: Record<string, string> = {
    semar: colors.semar,
    gareng: colors.gareng,
    petruk: colors.petruk,
    bagong: colors.bagong,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md, height: "100%" }}>
      <div style={{ display: "flex", gap: spacing.sm, alignItems: "center" }}>
        {minions.map((m) => (
          <button key={m.id} onClick={() => setSelected(m.id)}
            style={{
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderRadius: radius.full,
              border: "none",
              cursor: "pointer",
              background: selected === m.id ? (minionColors[m.id] || colors.gold) : "transparent",
              color: selected === m.id ? "#fff" : colors.textMuted,
              fontWeight: 600,
              fontSize: fontSize.sm,
              fontFamily: fonts.sans,
              transition: `all ${transition.fast}`,
            }}>
            {m.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={saveSoul} style={btnGold(saved)}>
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)}
        style={{
          flex: 1, minHeight: 300,
          ...glass.input,
          color: colors.text,
          borderRadius: radius.md,
          padding: spacing.lg,
          fontSize: fontSize.sm,
          lineHeight: 1.7,
          fontFamily: fonts.mono,
          resize: "none",
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          e.currentTarget.style.border = `1px solid ${colors.gold}`;
          e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.goldGlow}`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.border = glass.input.border as string;
          e.currentTarget.style.boxShadow = "none";
        }}
      />
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
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{
            fontWeight: 700, fontSize: fontSize.lg, color: colors.text,
            fontFamily: fonts.display,
          }}>
            Shared Context
          </div>
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fonts.sans }}>
            Injected into every minion's system prompt
          </div>
        </div>
        <button onClick={save} style={btnGold(saved)}>
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)}
        style={{
          flex: 1, minHeight: 300,
          ...glass.input,
          color: colors.text,
          borderRadius: radius.md,
          padding: spacing.lg,
          fontSize: fontSize.sm,
          lineHeight: 1.7,
          fontFamily: fonts.mono,
          resize: "none",
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          e.currentTarget.style.border = `1px solid ${colors.gold}`;
          e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.goldGlow}`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.border = glass.input.border as string;
          e.currentTarget.style.boxShadow = "none";
        }}
      />
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
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xl }}>
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

      <button onClick={save} style={{ ...btnGold(saved), alignSelf: "flex-end" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      <div style={{ display: "flex", gap: spacing.lg }}>
        <StatCard label="Total Input Tokens" value={usage.totalInputTokens || 0} />
        <StatCard label="Total Output Tokens" value={usage.totalOutputTokens || 0} />
      </div>

      <div style={{
        fontWeight: 700, fontSize: fontSize.md, marginTop: spacing.sm,
        color: colors.text, fontFamily: fonts.display,
      }}>
        Per Minion
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.md }}>
        {Object.entries(usage.byMinion || {}).map(([id, stats]: [string, any]) => {
          const minionColor = (colors as any)[id] || colors.goldDim;
          return (
            <div key={id} style={{
              ...glass.card,
              borderRadius: radius.lg,
              padding: spacing.lg,
            }}>
              <div style={{
                fontWeight: 700, fontSize: fontSize.md, marginBottom: spacing.sm,
                color: minionColor, fontFamily: fonts.sans,
              }}>
                {id}
              </div>
              <div style={{
                fontSize: fontSize.xs, color: colors.textMuted,
                display: "flex", flexDirection: "column", gap: spacing.xs,
                fontFamily: fonts.mono,
              }}>
                <span>prompts: <span style={{ color: colors.textSecondary }}>{stats.prompts}</span></span>
                <span>input: <span style={{ color: colors.textSecondary }}>{stats.inputTokens?.toLocaleString()}</span></span>
                <span>output: <span style={{ color: colors.textSecondary }}>{stats.outputTokens?.toLocaleString()}</span></span>
              </div>
            </div>
          );
        })}
      </div>
      {Object.keys(usage.byMinion || {}).length === 0 && (
        <EmptyState text="No usage data yet" />
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

  const minionColors: Record<string, string> = {
    semar: colors.semar,
    gareng: colors.gareng,
    petruk: colors.petruk,
    bagong: colors.bagong,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {events.length === 0 && <EmptyState text="No activity yet" />}
      {events.map((e) => (
        <div key={e.id} style={{
          display: "flex", gap: spacing.md, padding: `${spacing.sm}px 0`, fontSize: fontSize.xs,
          borderBottom: `1px solid ${colors.glassBorder}`,
          alignItems: "center",
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: radius.full, flexShrink: 0,
            background: minionColors[e.minionId] || colors.goldDim,
          }} />
          <span style={{
            color: colors.textLight, fontFamily: fonts.mono, flexShrink: 0, fontSize: 10,
          }}>
            {new Date(e.timestamp).toLocaleTimeString()}
          </span>
          <span style={{
            fontWeight: 600, color: minionColors[e.minionId] || colors.textSecondary, flexShrink: 0,
          }}>
            {e.minionName}
          </span>
          <span style={{ color: colors.textMuted }}>{e.summary}</span>
        </div>
      ))}
    </div>
  );
}

// --- Proposals Tab ---
function SectionHeader({ icon, title, badge }: { icon: string; title: string; badge?: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: spacing.sm,
      marginBottom: spacing.md,
    }}>
      <span style={{ fontSize: fontSize.md }}>{icon}</span>
      <span style={{
        fontSize: fontSize.sm, fontWeight: 700, color: colors.gold,
        fontFamily: fonts.display, letterSpacing: "0.3px",
      }}>
        {title}
      </span>
      {badge !== undefined && badge > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          background: "rgba(199, 84, 80, 0.2)",
          color: colors.error,
          padding: `1px ${spacing.sm}px`,
          borderRadius: radius.full,
          fontFamily: fonts.mono,
        }}>
          {badge} pending
        </span>
      )}
    </div>
  );
}

function TimelineItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const date = item.createdAt
    ? new Date(item.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div style={{
      display: "flex", gap: spacing.md, position: "relative",
    }}>
      {/* Timeline line + dot */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 16 }}>
        <div style={{
          width: 8, height: 8, borderRadius: radius.full, flexShrink: 0, marginTop: 4,
          background: item.type === "chance" ? colors.amber : colors.info,
          boxShadow: `0 0 6px ${item.type === "chance" ? colors.amber : colors.info}`,
        }} />
        <div style={{ flex: 1, width: 1, background: colors.glassBorder, marginTop: spacing.xs }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: spacing.lg }}>
        <div
          style={{ cursor: "pointer" }}
          onClick={() => setExpanded(!expanded)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm }}>
            <span style={{
              fontWeight: 600, fontSize: fontSize.sm, color: colors.text,
              fontFamily: fonts.sans, lineHeight: 1.4,
            }}>
              {item.title}
            </span>
            <span style={{
              fontSize: 10, color: colors.textLight, fontFamily: fonts.mono,
              flexShrink: 0, marginTop: 2,
            }}>
              {date}
            </span>
          </div>
        </div>

        {expanded && (
          <div style={{ marginTop: spacing.sm }}>
            <div style={{
              fontSize: fontSize.xs, color: colors.textMuted,
              whiteSpace: "pre-wrap", lineHeight: 1.7,
              ...glass.input, padding: spacing.md, borderRadius: radius.md,
              fontFamily: fonts.mono,
            }}>
              {item.description || "No description"}
            </div>
            {item.sources && item.sources.length > 0 && (
              <div style={{ marginTop: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.xs }}>
                {item.sources.map((src: string, i: number) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer" style={{
                    fontSize: fontSize.xs, color: colors.info,
                    fontFamily: fonts.mono, textDecoration: "none",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    display: "block",
                  }}>
                    ↗ {src}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BreathTab() {
  const [items, setItems] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch("/proposals").then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setLoading(id);
    try {
      await apiFetch(`/proposals/${id}/${action}`, { method: "POST" });
      load();
    } catch {}
    setLoading(null);
  };

  const priorityStyles: Record<string, { bg: string; color: string }> = {
    high: { bg: "rgba(199, 84, 80, 0.15)", color: colors.error },
    medium: { bg: "rgba(212, 160, 67, 0.15)", color: colors.amber },
    low: { bg: "rgba(90, 158, 111, 0.15)", color: colors.success },
  };

  // Separate by type (backward compat: no type = improvement)
  const improvements = items.filter((p) => p.id !== "init" && (p.type === "improvement" || !p.type));
  const chances = items
    .filter((p) => p.type === "chance")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const knowledge = items
    .filter((p) => p.type === "knowledge")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingImprovements = improvements.filter((p) => p.status === "pending");
  const doneImprovements = improvements.filter((p) => p.status !== "pending");

  const allEmpty = improvements.length === 0 && chances.length === 0 && knowledge.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xl }}>
      {allEmpty && (
        <EmptyState text="No breath data yet. The breath system runs periodically and generates insights." />
      )}

      {/* IMPROVEMENTS */}
      {improvements.length > 0 && (
        <section>
          <SectionHeader icon="🎯" title="Improvements" badge={pendingImprovements.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
            {pendingImprovements.map((p) => {
              const ps = priorityStyles[p.priority] || priorityStyles.medium;
              const isExpanded = expanded === p.id;
              return (
                <div key={p.id} style={{
                  ...glass.card, borderRadius: radius.lg, overflow: "hidden",
                  border: `1px solid ${colors.goldBorder}`,
                }}>
                  <div
                    style={{ padding: `${spacing.md}px ${spacing.lg}px`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(200, 163, 90, 0.05)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ display: "flex", gap: spacing.sm, alignItems: "center", flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: `2px ${spacing.sm}px`,
                        borderRadius: radius.sm, background: ps.bg, color: ps.color,
                        textTransform: "uppercase", fontFamily: fonts.mono, flexShrink: 0,
                      }}>
                        {p.priority || "medium"}
                      </span>
                      <span style={{
                        fontWeight: 600, fontSize: fontSize.sm, color: colors.text,
                        fontFamily: fonts.sans, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.title}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 10, color: colors.textLight,
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: `transform ${transition.fast}`, flexShrink: 0, marginLeft: spacing.sm,
                    }}>▼</span>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: `0 ${spacing.lg}px ${spacing.lg}px` }}>
                      <div style={{
                        fontSize: fontSize.xs, color: colors.textMuted, whiteSpace: "pre-wrap",
                        ...glass.input, padding: spacing.md, borderRadius: radius.md,
                        marginBottom: spacing.md, lineHeight: 1.7, fontFamily: fonts.mono,
                      }}>
                        {p.description || "No description"}
                      </div>
                      {p.estimatedImpact && (
                        <div style={{ fontSize: fontSize.xs, color: colors.success, marginBottom: spacing.md, fontFamily: fonts.sans }}>
                          Expected impact: {p.estimatedImpact}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: spacing.sm }}>
                        <button
                          onClick={() => handleAction(p.id, "approve")}
                          disabled={loading === p.id}
                          style={{ ...btnStyle(colors.success), padding: `${spacing.sm}px ${spacing.xl}px`, opacity: loading === p.id ? 0.6 : 1 }}
                        >
                          {loading === p.id ? "Executing..." : "Approve & Execute"}
                        </button>
                        <button
                          onClick={() => handleAction(p.id, "reject")}
                          disabled={loading === p.id}
                          style={{ ...btnGhost(), opacity: loading === p.id ? 0.6 : 1 }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {doneImprovements.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, marginTop: spacing.xs }}>
                <div style={{ fontSize: fontSize.xs, color: colors.textLight, fontFamily: fonts.mono, marginBottom: spacing.xs }}>
                  — history —
                </div>
                {doneImprovements.map((p) => (
                  <div key={p.id} style={{
                    padding: `${spacing.sm}px ${spacing.lg}px`, borderRadius: radius.md,
                    ...glass.card, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.5,
                  }}>
                    <span style={{ fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fonts.sans }}>{p.title}</span>
                    <span style={{
                      fontSize: 10, fontFamily: fonts.mono,
                      color: p.status === "completed" ? colors.success : colors.textLight,
                    }}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* CHANCE */}
      {chances.length > 0 && (
        <section>
          <SectionHeader icon="📈" title="Chance" />
          <div style={{ paddingLeft: spacing.xs }}>
            {chances.map((item) => <TimelineItem key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {/* KNOWLEDGE */}
      {knowledge.length > 0 && (
        <section>
          <SectionHeader icon="💡" title="Knowledge" />
          <div style={{ paddingLeft: spacing.xs }}>
            {knowledge.map((item) => <TimelineItem key={item.id} item={item} />)}
          </div>
        </section>
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
      <div style={{
        fontSize: fontSize.xs, fontWeight: 600, color: colors.textLight,
        marginBottom: spacing.xs, fontFamily: fonts.sans,
        textTransform: "uppercase", letterSpacing: "0.5px",
      }}>
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type || "text"}
        style={glassInputStyle}
        onFocus={(e) => {
          Object.assign(e.currentTarget.style, glassInputFocusStyle);
        }}
        onBlur={(e) => {
          e.currentTarget.style.border = glass.input.border as string;
          e.currentTarget.style.boxShadow = "none";
        }}
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
      <div onClick={() => onChange(!value)} style={{
        width: 36, height: 20, borderRadius: radius.full,
        background: value ? colors.success : colors.bgElevated,
        border: `1px solid ${value ? "rgba(90, 158, 111, 0.3)" : colors.glassBorder}`,
        cursor: "pointer",
        position: "relative",
        transition: `all ${transition.fast}`,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: radius.full,
          background: value ? "#fff" : colors.textLight,
          position: "absolute", top: 2,
          left: value ? 19 : 2,
          transition: `left ${transition.spring}`,
          boxShadow: shadows.sm,
        }} />
      </div>
      <span style={{ fontSize: fontSize.sm, color: colors.textSecondary, fontFamily: fonts.sans }}>
        {label}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      ...glass.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
    }}>
      <div style={{
        fontWeight: 700, fontSize: fontSize.md, marginBottom: spacing.md,
        color: colors.text, fontFamily: fonts.display,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      flex: 1,
      ...glass.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      textAlign: "center",
    }}>
      <div style={{
        fontSize: fontSize.xxl, fontWeight: 800, color: colors.gold,
        fontFamily: fonts.display,
      }}>
        {value.toLocaleString()}
      </div>
      <div style={{
        fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs,
        fontFamily: fonts.sans,
      }}>
        {label}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      color: colors.textLight,
      textAlign: "center",
      padding: spacing.xxxl,
      fontFamily: fonts.display,
      fontSize: fontSize.lg,
      fontStyle: "italic",
    }}>
      {text}
    </div>
  );
}
