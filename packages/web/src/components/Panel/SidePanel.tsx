import { useCallback, useState } from "react";
import { useStore } from "../../store";
import { ChatPanel } from "./ChatPanel";
import { PromptInput } from "./PromptInput";
import { ChatSearch, exportChatMarkdown } from "./ChatSearch";
import { TaskProgress } from "./TaskProgress";
import { colors, fonts, fontSize, spacing, radius, glass, transition, shadows } from "../../styles/tokens";
import type { ChatMessage } from "../../types";
import { IconSearch, IconTrash, IconStop, IconClose } from "../UI/Icons";

interface SidePanelProps {
  onSendPrompt: (minionId: string, prompt: string) => void;
  onStop: (minionId: string) => void;
  onClearChat: (minionId: string) => void;
}

const BALAI_MINION = {
  id: "balai",
  name: "Balai Desa",
  role: "Shared Channel — Tim Punakawan",
  color: colors.gold,
  status: "idle" as const,
};

// Map minion IDs to their token colors
const MINION_COLORS: Record<string, string> = {
  semar: colors.semar,
  gareng: colors.gareng,
  petruk: colors.petruk,
  bagong: colors.bagong,
  balai: colors.gold,
};

function getMinionColor(id: string, fallback?: string): string {
  return MINION_COLORS[id] || fallback || colors.gold;
}

// Inject global keyframes once
const STYLE_TAG_ID = "side-panel-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
    @keyframes sp-statusRingSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes sp-statusPulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(90, 158, 111, 0.4); }
      50% { opacity: 0.8; box-shadow: 0 0 0 6px rgba(90, 158, 111, 0); }
    }
  `;
  document.head.appendChild(style);
}

function ActionButton({
  onClick,
  ariaLabel,
  title,
  children,
  variant = "default",
}: {
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  children: React.ReactNode;
  variant?: "default" | "danger";
}) {
  const [hovered, setHovered] = useState(false);

  const bgDefault = hovered ? colors.surfaceGlass : "rgba(255,255,255,0.04)";
  const bgDanger = hovered ? colors.errorBg : "rgba(199, 84, 80, 0.06)";
  const borderDefault = hovered ? colors.glassBorder : "rgba(255,255,255,0.06)";
  const borderDanger = hovered ? colors.errorBorder : "rgba(199, 84, 80, 0.1)";

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: variant === "danger" ? bgDanger : bgDefault,
        border: `1px solid ${variant === "danger" ? borderDanger : borderDefault}`,
        color: variant === "danger" ? colors.error : colors.textMuted,
        borderRadius: radius.md,
        padding: `${spacing.xs + 2}px ${spacing.sm + 2}px`,
        cursor: "pointer",
        fontSize: fontSize.sm,
        fontFamily: fonts.sans,
        fontWeight: 500,
        lineHeight: 1,
        minWidth: 34,
        minHeight: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: `all ${transition.fast}`,
        transform: hovered ? "scale(1.08)" : "scale(1)",
      }}
    >
      {children}
    </button>
  );
}

export function SidePanel({ onSendPrompt, onStop, onClearChat }: SidePanelProps) {
  ensureKeyframes();

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
  const minionColor = minion ? getMinionColor(minion.id, minion.color) : colors.gold;

  return (
    <aside
      role="complementary"
      aria-label={minion ? `Chat with ${minion.name}` : "Chat panel"}
      className="side-panel"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 420,
        height: "100vh",
        ...glass.panel,
        background: colors.glassBg,
        borderLeft: `1px solid ${colors.glassBorder}`,
        transform: panelOpen ? "translateX(0)" : "translateX(100%)",
        transition: `transform ${transition.spring}`,
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: panelOpen ? `${shadows.xl}, ${shadows.glow}` : "none",
      }}
    >
      {/* Header */}
      <div style={{
        padding: `${spacing.lg}px ${spacing.xl}px`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
          {/* Avatar with animated status ring */}
          <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
            {/* Status ring — animated when working */}
            <div style={{
              position: "absolute",
              inset: -3,
              borderRadius: radius.full,
              border: `2px solid ${isWorking ? colors.working : "transparent"}`,
              borderTopColor: isWorking ? "transparent" : undefined,
              animation: isWorking ? "sp-statusRingSpin 1.2s linear infinite" : "none",
              transition: `border-color ${transition.normal}`,
            }} />
            {/* Pulse ring for working state */}
            {isWorking && (
              <div style={{
                position: "absolute",
                inset: -3,
                borderRadius: radius.full,
                animation: "sp-statusPulse 2s ease-in-out infinite",
              }} />
            )}
            {/* Avatar circle */}
            <div style={{
              width: 44,
              height: 44,
              borderRadius: radius.full,
              background: isBalai
                ? `linear-gradient(135deg, ${colors.goldDim}, ${colors.gold})`
                : `linear-gradient(135deg, ${minionColor}cc, ${minionColor})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.text,
              fontWeight: 800,
              fontSize: isBalai ? fontSize.lg : fontSize.md,
              fontFamily: fonts.display,
              boxShadow: `0 0 12px ${minionColor}33`,
            }}>
              {isBalai ? "B" : minion?.name?.[0] || "?"}
            </div>
            {/* Status dot */}
            <div style={{
              position: "absolute",
              bottom: 1,
              right: 1,
              width: 10,
              height: 10,
              borderRadius: radius.full,
              background: isWorking
                ? colors.working
                : minion?.status === "error"
                ? colors.error
                : colors.textLight,
              border: `2px solid ${colors.bg}`,
            }} />
          </div>

          {/* Name & role */}
          <div>
            <h2 style={{
              fontFamily: isBalai ? fonts.display : fonts.display,
              fontWeight: 400,
              fontSize: isBalai ? fontSize.xl : fontSize.lg,
              color: colors.text,
              margin: 0,
              letterSpacing: isBalai ? "0.02em" : 0,
              fontStyle: isBalai ? "italic" : "normal",
            }}>
              {minion?.name ?? "Select a minion"}
            </h2>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.xs,
              marginTop: 2,
            }}>
              <span style={{
                fontSize: fontSize.xs,
                color: isWorking ? colors.working : colors.textMuted,
                fontFamily: fonts.sans,
                transition: `color ${transition.fast}`,
              }}>
                {isBalai
                  ? anyWorking ? "Tim lagi nyambut gawe..." : minion?.role
                  : isWorking ? "Nyambut gawe..." : minion?.role || ""}
              </span>
              {messageCount > 0 && (
                <span style={{
                  fontSize: fontSize.xs,
                  color: colors.textLight,
                  fontFamily: fonts.mono,
                }}>
                  · {messageCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: spacing.xs }}>
          {minion && messages.length > 0 && (
            <ActionButton
              onClick={() => setSearchOpen(!searchOpen)}
              ariaLabel="Search messages"
              title="Search"
            >
              <IconSearch size={14} />
            </ActionButton>
          )}
          {minion && messages.length > 0 && !isWorking && (
            <ActionButton
              onClick={() => { if (confirm("Clear chat history?")) onClearChat(isBalai ? "balai" : minion.id); }}
              ariaLabel="Clear chat history"
              title="Clear chat"
            >
              <IconTrash size={14} />
            </ActionButton>
          )}
          {!isBalai && isWorking && (
            <ActionButton
              onClick={() => minion && onStop(minion.id)}
              ariaLabel="Stop minion"
              title="Stop"
              variant="danger"
            >
              <IconStop size={14} />
            </ActionButton>
          )}
          <ActionButton
            onClick={() => selectMinion(null)}
            ariaLabel="Close chat panel"
            title="Close"
          >
            <IconClose size={14} />
          </ActionButton>
        </div>
      </div>

      {/* Gold accent line */}
      <div style={{
        height: 1,
        background: `linear-gradient(to right, transparent, ${minionColor}44, ${minionColor}, ${minionColor}44, transparent)`,
        margin: `0 ${spacing.xl}px`,
      }} />

      {/* Search bar */}
      {searchOpen && minion && (
        <ChatSearch
          messages={messages}
          onClose={() => setSearchOpen(false)}
          onExport={() => exportChatMarkdown(messages, minion.name)}
          accentColor={minionColor}
        />
      )}

      {/* Task progress */}
      {minion && isWorking && (
        <TaskProgress minionId={isBalai ? "balai" : minion.id} />
      )}

      {/* Chat messages */}
      {minion && (
        <ChatPanel
          messages={messages}
          accentColor={minionColor}
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
          accentColor={minionColor}
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
