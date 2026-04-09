import { useState, useRef, useCallback } from "react";

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  onCommand?: (command: string) => void;
  disabled?: boolean;
  accentColor?: string;
  placeholder?: string;
}

const COMMANDS = [
  { cmd: "/clear", desc: "Clear chat history" },
  { cmd: "/status", desc: "Show minion status" },
  { cmd: "/help", desc: "Show available commands" },
];

export function PromptInput({ onSubmit, onCommand, disabled, accentColor = "#7c3aed", placeholder }: PromptInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Handle slash commands (always allowed, even when disabled/working)
    if (trimmed.startsWith("/")) {
      onCommand?.(trimmed);
      setValue("");
      setShowHints(false);
      requestAnimationFrame(() => {
        if (inputRef.current) inputRef.current.style.height = "auto";
      });
      return;
    }

    if (disabled) return;
    onSubmit(trimmed);
    setValue("");
    setShowHints(false);
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.style.height = "auto";
    });
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

  return (
    <div
      style={{
        padding: "12px 16px",
        borderTop: "1px solid #E8E8E8",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      {/* Command hints */}
      {matchingCommands.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 16,
            right: 16,
            background: "#FFF",
            border: "1px solid #E0E0E0",
            borderRadius: "8px",
            boxShadow: "0 -2px 8px rgba(0,0,0,0.08)",
            overflow: "hidden",
            marginBottom: 4,
          }}
        >
          {matchingCommands.map((c) => (
            <div
              key={c.cmd}
              onClick={() => {
                setValue(c.cmd);
                setShowHints(false);
                inputRef.current?.focus();
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                fontFamily: "'Inter', sans-serif",
                borderBottom: "1px solid #F0F0F0",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F5F5")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: accentColor }}>
                {c.cmd}
              </span>
              <span style={{ color: "#999" }}>{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          aria-label="Message input"
          placeholder={placeholder || (disabled ? "Working... (type /command)" : "Ask your minion something...")}
          rows={1}
          style={{
            flex: 1,
            background: "#F8F8F8",
            border: "1px solid #E0E0E0",
            borderRadius: "12px",
            padding: "10px 14px",
            color: "#333",
            fontFamily: "'Inter', sans-serif",
            fontSize: "13px",
            resize: "none",
            outline: "none",
            opacity: disabled && !value.startsWith("/") ? 0.5 : 1,
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = accentColor;
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "#E0E0E0";
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || (disabled && !value.trim().startsWith("/"))}
          style={{
            background:
              !value.trim() || (disabled && !value.trim().startsWith("/"))
                ? "#E0E0E0"
                : accentColor,
            color: "white",
            border: "none",
            borderRadius: "12px",
            padding: "10px 18px",
            cursor: disabled && !value.startsWith("/") ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: "13px",
            transition: "all 0.2s",
            minWidth: "60px",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
