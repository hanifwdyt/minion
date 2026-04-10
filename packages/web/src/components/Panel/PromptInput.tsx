import { useState, useRef, useCallback, useEffect } from "react";
import { colors, fonts, fontSize, radius, spacing, shadows, glass, transition } from "../../styles/tokens";

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  onCommand?: (command: string) => void;
  disabled?: boolean;
  accentColor?: string;
  placeholder?: string;
}

const COMMANDS = [
  { cmd: "/clear", desc: "Clear chat history", icon: "✦" },
  { cmd: "/status", desc: "Show minion status", icon: "◉" },
  { cmd: "/help", desc: "Show available commands", icon: "?" },
];

// ─── Keyframes (injected once) ───────────────────────────────────────────────
const STYLE_ID = "prompt-input-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pi-goldPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(200, 163, 90, 0); }
      50%      { box-shadow: 0 0 16px 2px rgba(200, 163, 90, 0.25); }
    }
    @keyframes pi-fadeInUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pi-send-btn:hover:not(:disabled) {
      transform: scale(1.1) !important;
      box-shadow: ${shadows.glow} !important;
    }
    .pi-send-btn:active:not(:disabled) {
      transform: scale(0.95) !important;
    }
    .pi-send-btn:disabled {
      cursor: not-allowed !important;
      opacity: 0.4 !important;
    }
    .pi-cmd-item:hover {
      background: rgba(200, 163, 90, 0.1) !important;
    }
    .pi-textarea:focus {
      border-color: rgba(200, 163, 90, 0.4) !important;
      box-shadow: 0 0 0 3px rgba(200, 163, 90, 0.08), ${shadows.sm} !important;
    }
    .pi-textarea::placeholder {
      color: ${colors.textLight};
    }
  `;
  document.head.appendChild(style);
}

export function PromptInput({
  onSubmit,
  onCommand,
  disabled,
  accentColor: _ac,
  placeholder,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, []);

  const resetHeight = useCallback(() => {
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.style.height = "auto";
    });
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Handle slash commands (always allowed, even when disabled/working)
    if (trimmed.startsWith("/")) {
      onCommand?.(trimmed);
      setValue("");
      setShowHints(false);
      resetHeight();
      return;
    }

    if (disabled) return;
    onSubmit(trimmed);
    setValue("");
    setShowHints(false);
    resetHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);
    setShowHints(val.startsWith("/") && val.length < 20);
    autoResize();
  };

  const matchingCommands = showHints
    ? COMMANDS.filter((c) => c.cmd.startsWith(value.trim().toLowerCase()))
    : [];

  const isDisabledSubmit = !value.trim() || (disabled && !value.trim().startsWith("/"));
  const isSlashMode = value.startsWith("/");

  return (
    <div
      style={{
        padding: `${spacing.md}px ${spacing.lg}px`,
        borderTop: `1px solid ${colors.glassBorder}`,
        ...glass.panel,
        position: "relative",
      }}
    >
      {/* Slash command hints dropdown */}
      {matchingCommands.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: spacing.lg,
            right: spacing.lg,
            ...glass.card,
            borderRadius: radius.md,
            boxShadow: shadows.lg,
            overflow: "hidden",
            marginBottom: spacing.xs,
            animation: "pi-fadeInUp 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
        >
          {matchingCommands.map((c, i) => (
            <div
              key={c.cmd}
              className="pi-cmd-item"
              onClick={() => {
                setValue(c.cmd);
                setShowHints(false);
                inputRef.current?.focus();
              }}
              style={{
                padding: `${spacing.sm + 2}px ${spacing.md}px`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
                fontSize: fontSize.sm,
                fontFamily: fonts.sans,
                borderBottom:
                  i < matchingCommands.length - 1
                    ? `1px solid ${colors.borderLight}`
                    : undefined,
                transition: `background ${transition.fast}`,
              }}
            >
              {/* Icon */}
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: radius.sm,
                  background: colors.goldGlow,
                  border: `1px solid ${colors.goldBorder}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: colors.gold,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {c.icon}
              </span>

              {/* Command text */}
              <span
                style={{
                  fontWeight: 600,
                  fontFamily: fonts.mono,
                  color: colors.gold,
                  fontSize: fontSize.sm,
                }}
              >
                {c.cmd}
              </span>

              {/* Description */}
              <span
                style={{
                  color: colors.textSecondary,
                  marginLeft: "auto",
                  fontSize: fontSize.xs,
                }}
              >
                {c.desc}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: spacing.sm,
          alignItems: "flex-end",
        }}
      >
        {/* Textarea container */}
        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            ref={inputRef}
            className="pi-textarea"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Message input"
            placeholder={
              placeholder ||
              (disabled
                ? "Working... (type / for commands)"
                : "Ask your minion something...")
            }
            rows={1}
            style={{
              width: "100%",
              boxSizing: "border-box",
              ...glass.input,
              borderRadius: radius.lg,
              padding: `${spacing.sm + 2}px ${spacing.lg}px`,
              paddingRight: focused || value ? spacing.lg : 90,
              color: colors.text,
              fontFamily: fonts.sans,
              fontSize: fontSize.md,
              resize: "none",
              outline: "none",
              opacity: disabled && !isSlashMode ? 0.6 : 1,
              transition: `all ${transition.normal}`,
              lineHeight: 1.5,
              ...(disabled && !isSlashMode
                ? {}
                : focused
                  ? {}
                  : {}),
            }}
          />

          {/* Keyboard shortcut hint (shown when not focused and empty) */}
          {!focused && !value && !disabled && (
            <div
              style={{
                position: "absolute",
                right: spacing.md,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                gap: spacing.xs,
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <kbd
                style={{
                  background: "rgba(200, 163, 90, 0.08)",
                  border: `1px solid ${colors.borderLight}`,
                  borderRadius: radius.sm - 2,
                  padding: "1px 6px",
                  fontSize: fontSize.xs,
                  fontFamily: fonts.mono,
                  color: colors.textLight,
                  lineHeight: 1.4,
                }}
              >
                Enter
              </kbd>
              <span
                style={{
                  fontSize: fontSize.xs,
                  color: colors.textLight,
                  fontFamily: fonts.sans,
                }}
              >
                to send
              </span>
            </div>
          )}
        </div>

        {/* Send button */}
        <button
          className="pi-send-btn"
          onClick={handleSubmit}
          disabled={!!isDisabledSubmit}
          aria-label={disabled && !isSlashMode ? "Agent is working" : "Send message"}
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.full,
            border: "none",
            background:
              isDisabledSubmit
                ? "rgba(200, 163, 90, 0.1)"
                : "linear-gradient(135deg, #C8A35A 0%, #D4A043 50%, #C8A35A 100%)",
            color: isDisabledSubmit ? colors.textLight : colors.textInverse,
            cursor: isDisabledSubmit ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            fontWeight: 700,
            flexShrink: 0,
            transition: `all ${transition.spring}`,
            boxShadow: isDisabledSubmit ? "none" : shadows.sm,
            ...(disabled && isSlashMode
              ? { animation: "pi-goldPulse 2s ease-in-out infinite" }
              : {}),
          }}
        >
          {disabled && !isSlashMode ? (
            // Pulsing dot for working state
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: colors.goldDim,
                animation: "pi-goldPulse 1.5s ease-in-out infinite",
              }}
            />
          ) : (
            // Send arrow
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      {/* Working state indicator */}
      {disabled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.sm,
            marginTop: spacing.sm,
            paddingLeft: spacing.xs,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: colors.gold,
              animation: "pi-goldPulse 1.5s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: fontSize.xs,
              color: colors.textSecondary,
              fontFamily: fonts.sans,
              letterSpacing: "0.02em",
            }}
          >
            Agent is working...
          </span>
          <span
            style={{
              fontSize: fontSize.xs,
              color: colors.textLight,
              fontFamily: fonts.mono,
              marginLeft: "auto",
            }}
          >
            type / for commands
          </span>
        </div>
      )}
    </div>
  );
}
