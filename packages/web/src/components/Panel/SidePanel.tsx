import { useCallback, useState } from "react";
import { useStore } from "../../store";
import { ChatPanel } from "./ChatPanel";
import { PromptInput } from "./PromptInput";
import { ChatSearch, exportChatMarkdown } from "./ChatSearch";
import type { ChatMessage } from "../../types";

interface SidePanelProps {
  onSendPrompt: (minionId: string, prompt: string) => void;
  onStop: (minionId: string) => void;
  onClearChat: (minionId: string) => void;
}

const BALAI_MINION = {
  id: "balai",
  name: "Balai Desa",
  role: "Shared Channel — Tim Punakawan",
  color: "#5D4037",
  status: "idle" as const,
};

export function SidePanel({ onSendPrompt, onStop, onClearChat }: SidePanelProps) {
  const { minions, selectedMinionId, panelOpen, selectMinion, chatMessages, addChatMessage, connected } = useStore();
  const isBalai = selectedMinionId === "balai";
  const minion = isBalai ? BALAI_MINION : minions.find((m) => m.id === selectedMinionId);
  const messages = selectedMinionId ? chatMessages[selectedMinionId] || [] : [];
  const messageCount = messages.filter((m) => m.role !== "tool").length;
  const anyWorking = minions.some((m) => m.status === "working");

  const handleCommand = useCallback((command: string) => {
    if (!minion) return;
    const minionId = isBalai ? "balai" : minion.id;

    const systemMsg = (content: string) => {
      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        minionId,
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
      addChatMessage(minionId, msg);
    };

    switch (command.toLowerCase()) {
      case "/clear":
        onClearChat(minionId);
        break;
      case "/status":
        systemMsg(
          `**${minion.name}** — ${minion.role}\n` +
          `- Status: ${isBalai ? (anyWorking ? "working" : "idle") : minion.status}\n` +
          `- Messages: ${messageCount}\n` +
          ("allowedTools" in minion ? `- Tools: \`${(minion as any).allowedTools}\`` : "")
        );
        break;
      case "/help":
        systemMsg(
          "**Available commands:**\n" +
          "- `/clear` — Clear chat history\n" +
          "- `/status` — Show minion info\n" +
          "- `/help` — Show this help\n\n" +
          "**Keyboard shortcuts:**\n" +
          "- `Esc` — Close panel\n" +
          "- `Enter` — Send message\n" +
          "- `Shift+Enter` — New line"
        );
        break;
      default:
        systemMsg(`Unknown command: \`${command}\`. Type \`/help\` for available commands.`);
    }
  }, [minion, isBalai, messageCount, anyWorking, addChatMessage, onClearChat]);

  const isWorking = isBalai ? anyWorking : minion?.status === "working";
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <aside
      role="complementary"
      aria-label={minion ? `Chat with ${minion.name}` : "Chat panel"}
      className="side-panel"
      style={{
        position: "fixed",
        top: 0, right: 0,
        width: "420px",
        height: "100vh",
        background: "#FFF8F0",
        borderLeft: "2px solid #DAA520",
        transform: panelOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: panelOpen ? "-4px 0 20px rgba(0,0,0,0.1)" : "none",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "14px 20px",
        borderBottom: "1px solid #E8E8E8",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#FFFFFF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            aria-hidden="true"
            style={{
              width: 36, height: 36, borderRadius: "50%",
              background: minion?.color || "#ccc",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: "14px",
            }}
          >
            {isBalai ? "🏛" : minion?.name?.[0] || "?"}
          </div>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: "15px", color: "#333", margin: 0 }}>
              {minion?.name ?? "Select a minion"}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                aria-label={isWorking ? "Working" : "Idle"}
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: isWorking ? "#2ecc71" : minion?.status === "error" ? "#e74c3c" : "#bbb",
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: "12px", color: "#666" }}>
                {isBalai
                  ? anyWorking ? "Tim lagi nyambut gawe..." : minion?.role
                  : isWorking ? "Nyambut gawe..." : minion?.role || ""}
              </span>
              {messageCount > 0 && (
                <span style={{ fontSize: "11px", color: "#999" }}>· {messageCount} messages</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          {minion && messages.length > 0 && (
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              aria-label="Search messages"
              title="Search"
              style={headerBtnStyle}
            >
              🔍
            </button>
          )}
          {minion && messages.length > 0 && !isWorking && (
            <button
              onClick={() => { if (confirm("Clear chat history?")) onClearChat(isBalai ? "balai" : minion.id); }}
              aria-label="Clear chat history"
              title="Clear chat"
              style={headerBtnStyle}
            >
              🗑
            </button>
          )}
          {!isBalai && isWorking && (
            <button
              onClick={() => minion && onStop(minion.id)}
              aria-label="Stop minion"
              style={{
                background: "#FFF0F0", color: "#E53935",
                border: "1px solid #FFCDD2", borderRadius: "8px",
                padding: "6px 12px", cursor: "pointer",
                fontSize: "12px", fontWeight: 600,
              }}
            >
              Stop
            </button>
          )}
          <button
            onClick={() => selectMinion(null)}
            aria-label="Close chat panel"
            style={headerBtnStyle}
          >
            ×
          </button>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && minion && (
        <ChatSearch
          messages={messages}
          onClose={() => setSearchOpen(false)}
          onExport={() => exportChatMarkdown(messages, minion.name)}
          accentColor={minion.color}
        />
      )}

      {/* Chat messages */}
      {minion && (
        <ChatPanel
          messages={messages}
          accentColor={minion.color}
          isWorking={isWorking || false}
          minionName={isBalai ? "Tim Punakawan" : minion.name}
        />
      )}

      {/* Input */}
      {minion && (
        <PromptInput
          onSubmit={(prompt) => onSendPrompt(isBalai ? "balai" : minion.id, prompt)}
          onCommand={handleCommand}
          disabled={!connected || (!isBalai && isWorking)}
          accentColor={minion.color}
          placeholder={
            !connected ? "Offline — waiting for connection..."
            : isWorking && !isBalai ? "Working on it..."
            : `Ask ${minion.name} something...`
          }
        />
      )}
    </aside>
  );
}

const headerBtnStyle: React.CSSProperties = {
  background: "#F5F5F5",
  border: "1px solid #E0E0E0",
  color: "#666",
  borderRadius: "8px",
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: "16px",
  lineHeight: 1,
  minWidth: "32px",
  minHeight: "32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
