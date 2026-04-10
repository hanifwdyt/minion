import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { MuteButton } from "./AudioManager";

const API = "/api";

export function TopBar() {
  const { minions, connected, selectedMinionId, selectMinion, activityOpen, setActivityOpen, setDashboardOpen, cameraMode, setCameraMode } = useStore();
  const workingCount = minions.filter((m) => m.status === "working").length;
  const isBalaiSelected = selectedMinionId === "balai";
  const [menuOpen, setMenuOpen] = useState(false);
  const [breathEnabled, setBreathEnabled] = useState(false);
  const [breathLoading, setBreathLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/breath/status`)
      .then((r) => r.json())
      .then((data) => setBreathEnabled(data.manualEnabled ?? false))
      .catch(() => {});
  }, []);

  async function toggleBreath() {
    setBreathLoading(true);
    try {
      const endpoint = breathEnabled ? "disable" : "enable";
      const res = await fetch(`${API}/breath/${endpoint}`, { method: "POST" });
      const data = await res.json();
      setBreathEnabled(data.manualEnabled ?? !breathEnabled);
    } catch {
      // silently fail
    } finally {
      setBreathLoading(false);
    }
  }

  return (
    <header
      role="banner"
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        height: "48px",
        background: "rgba(93, 64, 55, 0.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "2px solid #DAA520",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "20px" }} aria-hidden="true">🎭</span>
        <span style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "1px", color: "#FFE0B2" }}>
          PUNAKAWAN
        </span>
        <span style={{ fontSize: "11px", color: "#BCAAA4", fontWeight: 500 }} className="hide-mobile">
          Agen AI Nusantara
        </span>
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
        style={{
          display: "none",
          background: "none", border: "none", color: "#FFE0B2",
          fontSize: "20px", cursor: "pointer", padding: "4px 8px",
        }}
        className="show-mobile-only"
      >
        ☰
      </button>

      <nav
        role="navigation"
        aria-label="Main navigation"
        className="top-bar-buttons"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {/* Audio + Camera */}
        <MuteButton />

        {/* Breath toggle */}
        <button
          onClick={toggleBreath}
          disabled={breathLoading}
          title={breathEnabled ? "Breath ON (aktif sepanjang hari) — klik untuk balik ke jadwal malem" : "Breath OFF (jadwal malem aja) — klik untuk aktifin sepanjang hari"}
          aria-label={breathEnabled ? "Nonaktifkan breath manual mode" : "Aktifkan breath manual mode"}
          style={{
            ...iconBtnStyle(breathEnabled),
            opacity: breathLoading ? 0.5 : 1,
          }}
        >
          {breathEnabled ? "☀️" : "🌙"}
        </button>

        <button
          onClick={() => setCameraMode(cameraMode === "overview" ? "follow" : "overview")}
          aria-label={cameraMode === "follow" ? "Switch to overview camera" : "Switch to follow camera"}
          style={iconBtnStyle(cameraMode === "follow")}
        >
          {cameraMode === "follow" ? "🎯" : "🎥"}
        </button>

        {/* Dashboard */}
        <button
          onClick={() => setDashboardOpen(true)}
          aria-label="Open dashboard"
          style={iconBtnStyle(false)}
        >
          ⚙️
        </button>

        {/* Activity feed toggle */}
        <button
          onClick={() => setActivityOpen(!activityOpen)}
          aria-label={activityOpen ? "Close activity feed" : "Open activity feed"}
          style={iconBtnStyle(activityOpen)}
        >
          📋
        </button>

        {/* Balai Desa button */}
        <button
          onClick={() => selectMinion("balai")}
          aria-label="Open Balai Desa shared channel"
          aria-pressed={isBalaiSelected}
          style={{
            background: isBalaiSelected ? "rgba(218,165,32,0.3)" : "rgba(255,255,255,0.1)",
            border: isBalaiSelected ? "2px solid #DAA520" : "2px solid transparent",
            borderRadius: "14px",
            padding: "3px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#FFE0B2",
            fontSize: "11px",
            fontWeight: 700,
            transition: "all 0.2s",
            minHeight: "32px",
          }}
        >
          <span aria-hidden="true">🏛</span>
          <span className="hide-mobile">Balai Desa</span>
        </button>

        {/* Minion avatars */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }} role="group" aria-label="Minion selection">
          {minions.map((m) => (
            <button
              key={m.id}
              onClick={() => selectMinion(m.id)}
              aria-label={`${m.name} — ${m.status}`}
              aria-pressed={selectedMinionId === m.id}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: m.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFE0B2",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                border:
                  m.status === "working"
                    ? "2px solid #FFD54F"
                    : selectedMinionId === m.id
                    ? "2px solid #FFE0B2"
                    : "2px solid transparent",
                boxShadow: m.status === "working" ? "0 0 8px rgba(255,213,79,0.5)" : "none",
                transition: "all 0.3s",
                padding: 0,
              }}
            >
              {m.name?.[0] || "?"}
              <span className="sr-only">{m.name} — {m.status}</span>
            </button>
          ))}
        </div>

        {!connected && (
          <span
            role="alert"
            style={{
              fontSize: "12px", color: "#EF5350", fontWeight: 600,
              background: "rgba(239,83,80,0.15)",
              padding: "2px 10px", borderRadius: "10px",
              border: "1px solid rgba(239,83,80,0.3)",
              animation: "pulse 2s infinite",
            }}
          >
            Reconnecting...
          </span>
        )}

        {workingCount > 0 && (
          <span
            aria-live="polite"
            style={{
              fontSize: "12px", color: "#FFD54F", fontWeight: 600,
              background: "rgba(255,213,79,0.15)",
              padding: "2px 10px", borderRadius: "10px",
              border: "1px solid rgba(255,213,79,0.3)",
            }}
          >
            {workingCount} nyambut gawe
          </span>
        )}
      </nav>
    </header>
  );
}

function iconBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "rgba(218,165,32,0.3)" : "rgba(255,255,255,0.1)",
    border: active ? "2px solid #DAA520" : "2px solid transparent",
    borderRadius: "14px",
    padding: "3px 10px",
    cursor: "pointer",
    color: "#FFE0B2",
    fontSize: "14px",
    transition: "all 0.2s",
    minWidth: "32px",
    minHeight: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
