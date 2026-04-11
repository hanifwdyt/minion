import { useState, useEffect, useRef } from "react";
import { useStore } from "../../store";

const API = "";

async function checkAuthStatus(): Promise<{ hasAccount: boolean; authEnabled: boolean }> {
  const res = await fetch(`${API}/api/auth/status`);
  return res.json();
}

async function doLogin(email: string, password: string): Promise<{ token: string; user: string }> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "Login failed"), { status: res.status });
  return data;
}

async function doRegister(
  name: string,
  email: string,
  password: string
): Promise<{ token: string; user: string; name: string }> {
  const res = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "Register failed"), { status: res.status });
  return data;
}

export function LoginScreen() {
  const { setAuth } = useStore();
  const [tab, setTab] = useState<"signin" | "register" | null>(null);
  const [sliding, setSliding] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAuthStatus().then(({ hasAccount, authEnabled }) => {
      if (!authEnabled) {
        // Auth disabled — auto-login as anonymous
        doLogin("", "").then(({ token, user }) => setAuth(token, user)).catch(() => {});
        return;
      }
      setTab(hasAccount ? "signin" : "register");
    }).catch(() => setTab("signin"));
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function switchTab(next: "signin" | "register") {
    if (next === tab || sliding) return;
    setSliding(true);
    setError("");
    setTimeout(() => {
      setTab(next);
      setSliding(false);
    }, 200);
  }

  function startCountdown(seconds: number) {
    setCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (countdown > 0 || loading) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await doLogin(email, password);
      setAuth(token, user);
    } catch (err: any) {
      if (err.status === 429) {
        startCountdown(30);
        setError("Too many attempts.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (countdown > 0 || loading) return;
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const { token, user } = await doRegister(name, email, password);
      setAuth(token, user);
    } catch (err: any) {
      if (err.status === 429) {
        startCountdown(30);
        setError("Too many attempts.");
      } else {
        setError(err.message || "Register failed");
      }
    } finally {
      setLoading(false);
    }
  }

  if (tab === null) {
    return (
      <div style={styles.overlay}>
        <div style={{ color: "#C8A35A", fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" }}>
          Loading...
        </div>
      </div>
    );
  }

  const isDisabled = loading || countdown > 0;
  const btnLabel = countdown > 0
    ? `Try again in ${countdown}s`
    : loading
    ? tab === "signin" ? "Signing in..." : "Creating account..."
    : tab === "signin" ? "Sign In" : "Create Account";

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <span style={styles.logoText}>Minion</span>
          <span style={styles.logoSub}>Punakawan</span>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(tab === "signin" ? styles.tabActive : {}) }}
            onClick={() => switchTab("signin")}
          >
            Sign In
          </button>
          <button
            style={{ ...styles.tab, ...(tab === "register" ? styles.tabActive : {}) }}
            onClick={() => switchTab("register")}
          >
            Register
          </button>
          <div style={{ ...styles.tabIndicator, left: tab === "signin" ? "4px" : "50%" }} />
        </div>

        {/* Form */}
        <div style={{ ...styles.formWrap, opacity: sliding ? 0 : 1, transform: sliding ? "translateY(6px)" : "translateY(0)", transition: "opacity 0.2s, transform 0.2s" }}>
          <form onSubmit={tab === "signin" ? handleSignIn : handleRegister} style={styles.form}>
            {tab === "register" && (
              <div style={styles.field}>
                <label style={styles.label}>Name</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={tab === "signin"}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                style={styles.input}
                type="password"
                placeholder={tab === "register" ? "Min. 8 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {tab === "register" && (
              <div style={styles.field}>
                <label style={styles.label}>Confirm Password</label>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" disabled={isDisabled} style={{ ...styles.btn, ...(isDisabled ? styles.btnDisabled : {}) }}>
              {btnLabel}
            </button>
          </form>
        </div>

        <div style={styles.footer}>
          {tab === "signin" ? (
            <span>Belum punya akun? <button style={styles.link} onClick={() => switchTab("register")}>Register</button></span>
          ) : (
            <span>Sudah punya akun? <button style={styles.link} onClick={() => switchTab("signin")}>Sign In</button></span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "#1a1410",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(200,163,90,0.2)",
    borderRadius: 16,
    padding: "36px 40px 28px",
    width: 360,
    maxWidth: "90vw",
    backdropFilter: "blur(12px)",
  },
  logo: {
    textAlign: "center",
    marginBottom: 28,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  logoText: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: 28,
    color: "#C8A35A",
    letterSpacing: "0.04em",
  },
  logoSub: {
    fontSize: 11,
    color: "rgba(200,163,90,0.5)",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
  },
  tabs: {
    display: "flex",
    position: "relative",
    background: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: 500,
    padding: "7px 0",
    cursor: "pointer",
    borderRadius: 6,
    position: "relative",
    zIndex: 1,
    transition: "color 0.2s",
  },
  tabActive: {
    color: "#C8A35A",
  },
  tabIndicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    width: "calc(50% - 4px)",
    background: "rgba(200,163,90,0.12)",
    borderRadius: 6,
    border: "1px solid rgba(200,163,90,0.2)",
    transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
  },
  formWrap: {},
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  label: {
    fontSize: 12,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: "0.05em",
  },
  input: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#fff",
    fontSize: 14,
    padding: "9px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  error: {
    fontSize: 12,
    color: "#E57373",
    background: "rgba(229,115,115,0.08)",
    border: "1px solid rgba(229,115,115,0.2)",
    borderRadius: 6,
    padding: "7px 10px",
  },
  btn: {
    marginTop: 4,
    background: "linear-gradient(135deg, #C8A35A, #A07840)",
    border: "none",
    borderRadius: 8,
    color: "#1a1410",
    fontSize: 14,
    fontWeight: 600,
    padding: "11px",
    cursor: "pointer",
    transition: "opacity 0.15s",
    letterSpacing: "0.03em",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  footer: {
    marginTop: 20,
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
  },
  link: {
    background: "none",
    border: "none",
    color: "#C8A35A",
    fontSize: 12,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
};
