import { useEffect, useRef, useState, useCallback } from "react";
import { ChatBubble } from "./ChatBubble";
import { colors, fonts, fontSize, spacing, radius, transition, shadows } from "../../styles/tokens";
import type { ChatMessage } from "../../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  accentColor: string;
  isWorking?: boolean;
  minionName?: string;
}

const TYPING_STYLE_ID = "chat-panel-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(TYPING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TYPING_STYLE_ID;
  style.textContent = `
    @keyframes cp-dotWave {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-6px); opacity: 1; }
    }
    @keyframes cp-fadeSlideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes cp-floatGlyph {
      0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.06; }
      50% { transform: translateY(-4px) rotate(2deg); opacity: 0.1; }
    }
    @keyframes cp-newMsgPulse {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-2px); }
    }
    .chat-scroll::-webkit-scrollbar { width: 5px; }
    .chat-scroll::-webkit-scrollbar-track { background: transparent; }
    .chat-scroll::-webkit-scrollbar-thumb {
      background: ${colors.glassBorder};
      border-radius: ${radius.full}px;
    }
    .chat-scroll::-webkit-scrollbar-thumb:hover {
      background: ${colors.goldDim};
    }
  `;
  document.head.appendChild(style);
}

function TypingIndicator({ name, color }: { name: string; color: string }) {
  return (
    <div style={{
      padding: `${spacing.xs}px ${spacing.lg}px`,
      display: "flex",
      justifyContent: "flex-start",
      animation: "cp-fadeSlideIn 0.3s ease-out",
    }}>
      <div style={{
        background: colors.surfaceGlass,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: `${radius.lg}px ${radius.lg}px ${radius.lg}px ${radius.sm}px`,
        border: `1px solid ${colors.glassBorder}`,
        padding: `${spacing.sm + 2}px ${spacing.md + 2}px`,
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        fontSize: fontSize.sm,
        color: colors.textMuted,
        fontFamily: fonts.sans,
      }}>
        <span style={{ color, fontWeight: 600, fontSize: fontSize.xs }}>{name}</span>
        <span style={{ fontSize: fontSize.xs }}>lagi mikir</span>
        <span style={{ display: "inline-flex", gap: 3, marginLeft: 2 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: radius.full,
                background: color,
                display: "inline-block",
                animation: `cp-dotWave 1.4s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: spacing.lg,
      padding: spacing.xxl,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background wayang glyph decoration */}
      <div style={{
        position: "absolute",
        fontSize: 120,
        opacity: 0.05,
        color: colors.gold,
        fontFamily: fonts.display,
        userSelect: "none",
        pointerEvents: "none",
        animation: "cp-floatGlyph 6s ease-in-out infinite",
      }}>
        ꦏ
      </div>

      {/* Main content */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: radius.full,
        background: colors.goldGlow,
        border: `1px solid ${colors.goldBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={colors.goldDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{
          fontFamily: fonts.display,
          fontSize: fontSize.xl,
          color: colors.textMuted,
          marginBottom: spacing.xs,
          fontStyle: "italic",
        }}>
          Mangga, silakan ngobrol
        </div>
        <div style={{
          fontSize: fontSize.xs,
          color: colors.textLight,
          fontFamily: fonts.sans,
          lineHeight: 1.5,
        }}>
          Powered by Claude Code
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, accentColor, isWorking, minionName }: ChatPanelProps) {
  ensureKeyframes();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const isNearBottom = useRef(true);
  const prevMessageCount = useRef(messages.length);

  const scrollToBottom = useCallback((smooth = true) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    }
    setShowNewMsg(false);
  }, []);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isNearBottom.current) {
      setShowNewMsg(false);
    }
  }, []);

  // Auto-scroll or show indicator on new messages
  useEffect(() => {
    if (messages.length === prevMessageCount.current) return;
    const isNewMessage = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;

    if (!isNewMessage) return;

    if (isNearBottom.current) {
      // Small delay to let DOM render
      requestAnimationFrame(() => scrollToBottom(true));
    } else {
      setShowNewMsg(true);
    }
  }, [messages.length, scrollToBottom]);

  // Scroll to bottom on initial mount
  useEffect(() => {
    scrollToBottom(false);
  }, []);

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <div
        ref={scrollRef}
        className="chat-scroll"
        onScroll={handleScroll}
        style={{
          height: "100%",
          overflowY: "auto",
          padding: `${spacing.md}px 0`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.xs,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} accentColor={accentColor} />
            ))}
            {isWorking && minionName && (
              <TypingIndicator name={minionName} color={accentColor} />
            )}
          </>
        )}
        <div ref={bottomRef} style={{ height: 1, flexShrink: 0 }} />
      </div>

      {/* New messages indicator */}
      {showNewMsg && (
        <button
          onClick={() => scrollToBottom(true)}
          style={{
            position: "absolute",
            bottom: spacing.md,
            left: "50%",
            transform: "translateX(-50%)",
            background: colors.surfaceGlass,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${colors.goldBorder}`,
            borderRadius: radius.full,
            padding: `${spacing.xs + 2}px ${spacing.lg}px`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: spacing.xs,
            fontSize: fontSize.xs,
            fontFamily: fonts.sans,
            fontWeight: 500,
            color: colors.gold,
            boxShadow: `0 4px 16px rgba(0,0,0,0.3), ${shadows.glow}`,
            animation: "cp-fadeSlideIn 0.2s ease-out, cp-newMsgPulse 2s ease-in-out infinite",
            zIndex: 10,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          New messages
        </button>
      )}
    </div>
  );
}
