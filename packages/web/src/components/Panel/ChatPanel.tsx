import { useEffect, useRef } from "react";
import { ChatBubble } from "./ChatBubble";
import type { ChatMessage } from "../../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  accentColor: string;
  isWorking?: boolean;
  minionName?: string;
}

function TypingIndicator({ name, color }: { name: string; color: string }) {
  return (
    <div style={{ padding: "4px 16px", display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: "16px 16px 16px 4px",
          padding: "10px 14px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          color: "#888",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <span style={{ color, fontWeight: 600 }}>{name}</span>
        <span>lagi mikir</span>
        <span style={{ display: "inline-flex", gap: "2px" }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: color,
                opacity: 0.6,
                animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </span>
        <style>{`
          @keyframes bounce {
            0%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-6px); }
          }
        `}</style>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, accentColor, isWorking, minionName }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 0",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        background: "#FAFAFA",
      }}
    >
      {messages.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#999",
            fontSize: "14px",
            gap: "8px",
          }}
        >
          <div style={{ fontSize: "32px" }}>💬</div>
          <div>Start chatting with this minion!</div>
          <div style={{ fontSize: "12px", color: "#BBB" }}>
            They'll use Claude Code to help you
          </div>
        </div>
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
    </div>
  );
}
