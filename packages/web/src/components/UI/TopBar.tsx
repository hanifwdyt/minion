import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { MuteButton } from "./AudioManager";
import { colors, fonts, fontSize, shadows, transition, glass, radius } from "../../styles/tokens";

const API = "/api";

export function TopBar() {
  const { minions, connected, selectedMinionId, selectMinion, activityOpen, setActivityOpen, setDashboardOpen, cameraMode, setCameraMode } = useStore();
  const workingCount = minions.filter((m) => m.status === "working").length;
  const isBalaiSelected = selectedMinionId === "balai";
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
    } catch {} finally {
      setBreathLoading(false);
    }
  }

  return (
    <header
      role="banner"
      style={{
        position: "fixed",
        top: 12, left: 16, right: 16,
        height: 52,
        ...glass.panel,
        borderRadius: radius.xl,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        zIndex: 50,
        boxShadow: shadows.lg,
        animation: "fadeInDown 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: radius.md,
          background: `linear-gradient(135deg, ${colors.gold}, ${colors.goldDim})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14,
          boxShadow: shadows.glow,
        }}>
          🎭
        </div>
        <div>
          <span style={{
            fontFamily: fonts.display,
            fontSize: fontSize.lg,
            color: colors.parchment,
            letterSpacing: 0.5,
          }}>
            Punakawan
          </span>
          <span style={{
            fontSize: fontSize.xs,
            color: colors.textMuted,
            marginLeft: 8,
            fontWeight: 400,
          }} className="hide-mobile">
            Agen AI Nusantara
          </span>
        </div>
      </div>

      {/* Controls */}
      <nav role="navigation" aria-label="Main navigation" className="top-bar-buttons"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        <MuteButton />

        <IconBtn
          onClick={toggleBreath}
          disabled={breathLoading}
          active={breathEnabled}
          label={breathEnabled ? "Breath ON" : "Breath OFF"}
          icon={breathEnabled ? "☀️" : "🌙"}
        />

        <IconBtn
          onClick={() => setCameraMode(cameraMode === "overview" ? "follow" : "overview")}
          active={cameraMode === "follow"}
          label={cameraMode === "follow" ? "Overview camera" : "Follow camera"}
          icon={cameraMode === "follow" ? "🎯" : "🎥"}
        />

        <IconBtn
          onClick={() => setDashboardOpen(true)}
          active={false}
          label="Dashboard"
          icon="⚙️"
        />

        <IconBtn
          onClick={() => setActivityOpen(!activityOpen)}
          active={activityOpen}
          label="Activity"
          icon="📋"
        />

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: colors.glassBorder, margin: "0 4px" }} />

        {/* Balai Desa */}
        <button
          onClick={() => selectMinion("balai")}
          aria-label="Balai Desa"
          style={{
            background: isBalaiSelected
              ? `linear-gradient(135deg, rgba(200,163,90,0.25), rgba(200,163,90,0.1))`
              : "rgba(255,255,255,0.04)",
            border: isBalaiSelected ? `1px solid ${colors.goldBorder}` : "1px solid transparent",
            borderRadius: radius.lg,
            padding: "5px 14px",
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            color: isBalaiSelected ? colors.gold : colors.textSecondary,
            fontSize: fontSize.xs,
            fontWeight: 600,
            fontFamily: fonts.sans,
            transition: `all ${transition.normal}`,
            letterSpacing: 0.3,
          }}
          onMouseEnter={(e) => {
            if (!isBalaiSelected) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            if (!isBalaiSelected) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          }}
        >
          🏛 <span className="hide-mobile">Balai</span>
        </button>

        {/* Minion Avatars */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 2 }}>
          {minions.map((m, i) => {
            const isSelected = selectedMinionId === m.id;
            const isWorking = m.status === "working";
            const minionColor = (colors as any)[m.id] || m.color;

            return (
              <button
                key={m.id}
                onClick={() => selectMinion(m.id)}
                aria-label={`${m.name} — ${m.status}`}
                style={{
                  width: 32, height: 32,
                  borderRadius: radius.full,
                  background: isSelected
                    ? `linear-gradient(135deg, ${minionColor}, ${minionColor}88)`
                    : `${minionColor}33`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: isSelected ? colors.parchment : minionColor,
                  fontSize: fontSize.xs,
                  fontWeight: 700,
                  fontFamily: fonts.sans,
                  cursor: "pointer",
                  border: isSelected
                    ? `2px solid ${minionColor}`
                    : "2px solid transparent",
                  boxShadow: isWorking ? `0 0 12px ${minionColor}44` : "none",
                  transition: `all ${transition.spring}`,
                  padding: 0,
                  position: "relative",
                  marginLeft: i > 0 ? -4 : 0,
                  zIndex: isSelected ? 3 : isWorking ? 2 : 1,
                  animation: isWorking ? "pulseGlow 2s infinite" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.15)";
                  e.currentTarget.style.zIndex = "5";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.zIndex = isSelected ? "3" : "1";
                }}
              >
                {m.name?.[0]}
                {/* Status dot */}
                {isWorking && (
                  <span style={{
                    position: "absolute", bottom: -1, right: -1,
                    width: 8, height: 8, borderRadius: "50%",
                    background: colors.success,
                    border: `2px solid ${colors.bg}`,
                    animation: "statusPulse 1.5s infinite",
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Status indicators */}
        {!connected && (
          <span role="alert" style={{
            fontSize: fontSize.xs, color: colors.error, fontWeight: 500,
            background: `${colors.error}15`,
            padding: "3px 10px", borderRadius: radius.full,
            border: `1px solid ${colors.error}30`,
            animation: "breathe 2s infinite",
            fontFamily: fonts.sans,
          }}>
            Reconnecting
          </span>
        )}

        {workingCount > 0 && (
          <span aria-live="polite" style={{
            fontSize: fontSize.xs, color: colors.gold, fontWeight: 600,
            background: colors.goldGlow,
            padding: "3px 10px", borderRadius: radius.full,
            border: `1px solid ${colors.goldBorder}`,
            fontFamily: fonts.sans,
            letterSpacing: 0.3,
          }}>
            {workingCount} nyambut gawe
          </span>
        )}
      </nav>
    </header>
  );
}

function IconBtn({ onClick, active, label, icon, disabled }: {
  onClick: () => void;
  active: boolean;
  label: string;
  icon: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        background: active
          ? `linear-gradient(135deg, rgba(200,163,90,0.2), rgba(200,163,90,0.08))`
          : "rgba(255,255,255,0.03)",
        border: active ? `1px solid ${colors.goldBorder}` : "1px solid transparent",
        borderRadius: radius.md,
        padding: "5px 8px",
        cursor: disabled ? "default" : "pointer",
        color: active ? colors.gold : colors.textMuted,
        fontSize: 14,
        transition: `all ${transition.normal}`,
        minWidth: 32, minHeight: 32,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.transform = "scale(1.08)";
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
          e.currentTarget.style.transform = "scale(1)";
        }
      }}
    >
      {icon}
    </button>
  );
}
