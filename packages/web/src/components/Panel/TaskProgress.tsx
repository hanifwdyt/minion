import { useEffect, useState } from "react";
import { colors, fonts, fontSize, spacing, radius, glass, transition, shadows } from "../../styles/tokens";

interface TaskStep {
  id: string;
  minionId: string;
  summary: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  toolName?: string;
  detail?: string;
  timestamp: number;
}

interface TaskProgressData {
  minionId: string;
  title: string;
  steps: TaskStep[];
  startedAt: number;
}

interface TaskProgressProps {
  minionId: string;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

const STYLE_TAG_ID = "task-progress-keyframes";

function ensureKeyframes() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    @keyframes tp-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes tp-fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes tp-progressPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    @keyframes tp-shimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
  `;
  document.head.appendChild(style);
}

function StepIcon({ status }: { status: TaskStep["status"] }) {
  if (status === "completed") {
    return (
      <span style={{
        width: 18, height: 18, borderRadius: radius.full,
        background: `linear-gradient(135deg, ${colors.success}, #4A8E5F)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: colors.text, fontWeight: 700, flexShrink: 0,
      }}>
        ✓
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span style={{
        width: 18, height: 18, borderRadius: radius.full,
        border: `2px solid ${colors.gold}`,
        borderTopColor: "transparent",
        display: "inline-block", flexShrink: 0,
        animation: "tp-spin 0.8s linear infinite",
      }} />
    );
  }
  if (status === "failed") {
    return (
      <span style={{
        width: 18, height: 18, borderRadius: radius.full,
        background: colors.error,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: colors.text, fontWeight: 700, flexShrink: 0,
      }}>
        ✕
      </span>
    );
  }
  // pending
  return (
    <span style={{
      width: 18, height: 18, borderRadius: radius.full,
      border: `2px solid ${colors.textLight}`,
      display: "inline-block", flexShrink: 0, opacity: 0.4,
    }} />
  );
}

export function TaskProgress({ minionId }: TaskProgressProps) {
  const [progress, setProgress] = useState<TaskProgressData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [doneCode, setDoneCode] = useState<number | null>(null);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Listen to socket events via window custom events (bridged from useSocket)
  // We use a simpler approach: listen on window for forwarded socket events
  useEffect(() => {
    const handleStart = (e: CustomEvent) => {
      const data = e.detail;
      if (data.minionId === minionId || minionId === "balai") {
        setProgress({ minionId: data.minionId, title: data.title, steps: [], startedAt: Date.now() });
        setDoneCode(null);
        setCollapsed(false);
      }
    };
    const handleStep = (e: CustomEvent) => {
      const data = e.detail;
      if (data.minionId === minionId || minionId === "balai") {
        setProgress(data.progress);
      }
    };
    const handleDone = (e: CustomEvent) => {
      const data = e.detail;
      if (data.minionId === minionId || minionId === "balai") {
        setProgress(data.progress);
        setDoneCode(data.code);
        // Auto-collapse after 5s
        setTimeout(() => setCollapsed(true), 5000);
        // Auto-dismiss after 15s
        setTimeout(() => setProgress(null), 15000);
      }
    };

    window.addEventListener("task:start", handleStart as EventListener);
    window.addEventListener("task:step", handleStep as EventListener);
    window.addEventListener("task:done", handleDone as EventListener);
    return () => {
      window.removeEventListener("task:start", handleStart as EventListener);
      window.removeEventListener("task:step", handleStep as EventListener);
      window.removeEventListener("task:done", handleDone as EventListener);
    };
  }, [minionId]);

  // Elapsed timer
  useEffect(() => {
    if (!progress || doneCode !== null) return;
    const iv = setInterval(() => {
      setElapsed(Date.now() - progress.startedAt);
    }, 1000);
    return () => clearInterval(iv);
  }, [progress, doneCode]);

  if (!progress) return null;

  const completedCount = progress.steps.filter((s) => s.status === "completed").length;
  const totalSteps = progress.steps.length;
  const ratio = totalSteps > 0 ? completedCount / totalSteps : 0;
  const isDone = doneCode !== null;
  const isSuccess = doneCode === 0;

  // Only show last 6 steps when expanded
  const visibleSteps = collapsed ? [] : progress.steps.slice(-6);

  return (
    <div style={{
      margin: `${spacing.sm}px ${spacing.md}px`,
      ...glass.card,
      borderRadius: radius.lg,
      overflow: "hidden",
      boxShadow: shadows.md,
      animation: "tp-fadeIn 0.3s ease-out",
    }}>
      {/* Header - always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: `${spacing.md}px ${spacing.lg}px`,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          color: colors.text,
          fontFamily: fonts.sans,
          fontSize: fontSize.sm,
          textAlign: "left",
        }}
      >
        {/* Status indicator */}
        {isDone ? (
          <span style={{
            width: 8, height: 8, borderRadius: radius.full,
            background: isSuccess ? colors.success : colors.error,
            flexShrink: 0,
          }} />
        ) : (
          <span style={{
            width: 8, height: 8, borderRadius: radius.full,
            background: colors.gold,
            flexShrink: 0,
            animation: "tp-progressPulse 1.5s ease-in-out infinite",
          }} />
        )}

        {/* Title */}
        <span style={{
          flex: 1,
          fontFamily: fonts.mono,
          fontSize: fontSize.xs,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: isDone ? colors.textMuted : colors.text,
        }}>
          {progress.title}
        </span>

        {/* Counter + elapsed */}
        <span style={{
          fontSize: fontSize.xs,
          color: colors.textMuted,
          fontFamily: fonts.mono,
          flexShrink: 0,
        }}>
          {isDone
            ? (isSuccess ? "done" : "failed")
            : `${completedCount}${totalSteps > 0 ? `/${totalSteps}` : ""}`
          }
          {" · "}
          {formatElapsed(isDone ? (progress.steps.at(-1)?.timestamp || Date.now()) - progress.startedAt : elapsed)}
        </span>

        {/* Chevron */}
        <span style={{
          fontSize: 12,
          color: colors.textLight,
          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: `transform ${transition.fast}`,
          flexShrink: 0,
        }}>
          ▾
        </span>
      </button>

      {/* Progress bar */}
      <div style={{
        height: 2,
        background: colors.borderLight,
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: isDone ? "100%" : `${Math.max(ratio * 100, totalSteps > 0 ? 5 : 0)}%`,
          background: isDone
            ? (isSuccess ? colors.success : colors.error)
            : `linear-gradient(90deg, ${colors.goldDim}, ${colors.gold}, ${colors.goldBright})`,
          backgroundSize: isDone ? "100%" : "200% 100%",
          animation: isDone ? "none" : "tp-shimmer 2s linear infinite",
          transition: `width ${transition.normal}`,
          borderRadius: radius.full,
        }} />
      </div>

      {/* Steps list */}
      {!collapsed && visibleSteps.length > 0 && (
        <div style={{
          padding: `${spacing.sm}px ${spacing.lg}px ${spacing.md}px`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.xs,
        }}>
          {progress.steps.length > 6 && (
            <div style={{
              fontSize: fontSize.xs,
              color: colors.textLight,
              fontFamily: fonts.mono,
              paddingLeft: spacing.xl + spacing.xs,
            }}>
              ... {progress.steps.length - 6} earlier steps
            </div>
          )}
          {visibleSteps.map((step, i) => (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
                animation: `tp-fadeIn 0.2s ease-out ${i * 0.05}s both`,
              }}
            >
              <StepIcon status={step.status} />
              <span style={{
                fontSize: fontSize.xs,
                fontFamily: fonts.mono,
                color: step.status === "in_progress" ? colors.text
                  : step.status === "completed" ? colors.textMuted
                  : step.status === "failed" ? colors.error
                  : colors.textLight,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}>
                {step.summary}
              </span>
              {step.toolName && (
                <span style={{
                  fontSize: 10,
                  color: colors.textLight,
                  fontFamily: fonts.mono,
                  flexShrink: 0,
                  background: colors.borderLight,
                  padding: "1px 6px",
                  borderRadius: radius.sm,
                }}>
                  {step.toolName}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
