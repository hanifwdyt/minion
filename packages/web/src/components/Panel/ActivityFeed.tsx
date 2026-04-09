import { useEffect, useRef } from "react";

interface ActivityEvent {
  id: string;
  minionId: string;
  minionName: string;
  type: string;
  summary: string;
  timestamp: number;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  open: boolean;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  prompt: "💬",
  response: "💭",
  tool: "🔧",
  status: "📍",
  error: "❌",
  pipeline: "🔗",
  delegate: "👉",
};

const MINION_COLORS: Record<string, string> = {
  semar: "#DAA520",
  gareng: "#CC5500",
  petruk: "#8B1A1A",
  bagong: "#1B5E20",
  balai: "#5D4037",
};

export function ActivityFeed({ events, open, onClose }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (!open) return null;

  return (
    <div
      role="log"
      aria-label="Activity feed"
      className="activity-feed"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "220px",
        background: "rgba(40, 30, 25, 0.95)",
        backdropFilter: "blur(8px)",
        borderTop: "2px solid #DAA520",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(218,165,32,0.2)",
        }}
      >
        <span style={{ color: "#FFE0B2", fontWeight: 700, fontSize: "12px", letterSpacing: "1px" }}>
          ACTIVITY FEED
        </span>
        <button
          onClick={onClose}
          aria-label="Close activity feed"
          style={{
            background: "none",
            border: "none",
            color: "#BCAAA4",
            fontSize: "16px",
            cursor: "pointer",
            minWidth: "32px",
            minHeight: "32px",
          }}
        >
          ×
        </button>
      </div>

      {/* Events */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 16px",
        }}
      >
        {events.length === 0 ? (
          <div style={{ color: "#666", fontSize: "12px", textAlign: "center", paddingTop: 20 }}>
            No activity yet
          </div>
        ) : (
          events.map((event) => {
            const time = new Date(event.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const color = MINION_COLORS[event.minionId] || "#888";

            return (
              <div
                key={event.id}
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "3px 0",
                  fontSize: "11px",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#666", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {time}
                </span>
                <span style={{ flexShrink: 0 }}>{TYPE_ICONS[event.type] || "•"}</span>
                <span style={{ color, fontWeight: 600, flexShrink: 0 }}>
                  {event.minionName}
                </span>
                <span style={{ color: "#BCAAA4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.summary}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
