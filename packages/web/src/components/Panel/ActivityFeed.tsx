import { useEffect, useRef, useState } from "react";
import { colors, fonts, fontSize, radius, spacing, shadows, glass, transition } from "../../styles/tokens";

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

const MINION_COLORS: Record<string, string> = {
  semar: colors.semar,
  gareng: colors.gareng,
  petruk: colors.petruk,
  bagong: colors.bagong,
  balai: colors.goldDim,
};

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 220;

export function ActivityFeed({ events, open, onClose }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  // When open changes externally, sync expanded state
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // Auto-scroll when new events arrive (only in expanded mode)
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, expanded]);

  if (!open && events.length === 0) return null;

  const latestEvent = events[events.length - 1];
  const currentHeight = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

  return (
    <div
      role="log"
      aria-label="Activity feed"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: currentHeight,
        ...glass.panel,
        background: colors.glassBg,
        borderTop: `1px solid ${colors.glassBorder}`,
        borderRadius: expanded ? `${radius.lg}px ${radius.lg}px 0 0` : 0,
        boxShadow: expanded ? shadows.lg : shadows.sm,
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        fontFamily: fonts.sans,
        transition: `height ${transition.spring}`,
        overflow: "hidden",
      }}
    >
      {/* Collapsed bar / Header */}
      <div
        onClick={() => {
          if (!expanded) setExpanded(true);
        }}
        style={{
          height: COLLAPSED_HEIGHT,
          minHeight: COLLAPSED_HEIGHT,
          padding: `0 ${spacing.lg}px`,
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
          cursor: expanded ? "default" : "pointer",
          borderBottom: expanded ? `1px solid ${colors.glassBorder}` : "none",
          transition: `border-bottom ${transition.fast}`,
        }}
      >
        {/* Pulse dot */}
        {latestEvent && (
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: radius.full,
              background: MINION_COLORS[latestEvent.minionId] || colors.gold,
              boxShadow: `0 0 6px ${MINION_COLORS[latestEvent.minionId] || colors.gold}`,
              flexShrink: 0,
            }}
          />
        )}

        {/* Latest event one-liner */}
        <div
          style={{
            flex: 1,
            fontSize: fontSize.xs,
            color: colors.textMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: fonts.mono,
            letterSpacing: "0.2px",
          }}
        >
          {latestEvent ? (
            <>
              <span style={{ color: MINION_COLORS[latestEvent.minionId] || colors.textSecondary, fontWeight: 600 }}>
                {latestEvent.minionName}
              </span>
              <span style={{ color: colors.textLight, margin: `0 ${spacing.sm}px` }}>
                {relativeTime(latestEvent.timestamp)}
              </span>
              <span style={{ color: colors.textMuted }}>{latestEvent.summary}</span>
            </>
          ) : (
            <span style={{ color: colors.textLight }}>No activity yet</span>
          )}
        </div>

        {/* Event count badge */}
        {events.length > 0 && !expanded && (
          <div
            style={{
              fontSize: fontSize.xs,
              color: colors.gold,
              background: colors.goldGlow,
              padding: `2px ${spacing.sm}px`,
              borderRadius: radius.full,
              fontWeight: 600,
              fontFamily: fonts.mono,
            }}
          >
            {events.length}
          </div>
        )}

        {/* Expand/Close button */}
        {expanded ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
              onClose();
            }}
            aria-label="Close activity feed"
            style={{
              background: "none",
              border: "none",
              color: colors.textLight,
              fontSize: 18,
              cursor: "pointer",
              minWidth: 28,
              minHeight: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              transition: `color ${transition.fast}`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.textLight)}
          >
            ×
          </button>
        ) : (
          <div
            style={{
              fontSize: 10,
              color: colors.textLight,
              transform: "rotate(180deg)",
              transition: `transform ${transition.fast}`,
            }}
          >
            ▾
          </div>
        )}
      </div>

      {/* Expanded event feed */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `${spacing.sm}px ${spacing.lg}px`,
          opacity: expanded ? 1 : 0,
          transition: `opacity ${transition.normal}`,
        }}
      >
        {events.length === 0 ? (
          <div
            style={{
              color: colors.textLight,
              fontSize: fontSize.sm,
              textAlign: "center",
              paddingTop: spacing.xl,
              fontFamily: fonts.display,
              fontStyle: "italic",
            }}
          >
            No activity yet
          </div>
        ) : (
          events.map((event) => {
            const dotColor = MINION_COLORS[event.minionId] || colors.textLight;

            return (
              <div
                key={event.id}
                style={{
                  display: "flex",
                  gap: spacing.sm,
                  padding: `3px 0`,
                  fontSize: fontSize.xs,
                  alignItems: "center",
                }}
              >
                {/* Colored dot */}
                <div
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: radius.full,
                    background: dotColor,
                    flexShrink: 0,
                    opacity: 0.9,
                  }}
                />

                {/* Relative time */}
                <span
                  style={{
                    color: colors.textLight,
                    fontFamily: fonts.mono,
                    fontSize: 10,
                    flexShrink: 0,
                    minWidth: 28,
                    textAlign: "right",
                  }}
                >
                  {relativeTime(event.timestamp)}
                </span>

                {/* Minion name */}
                <span
                  style={{
                    color: dotColor,
                    fontWeight: 600,
                    flexShrink: 0,
                    fontSize: fontSize.xs,
                  }}
                >
                  {event.minionName}
                </span>

                {/* Summary */}
                <span
                  style={{
                    color: colors.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
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
