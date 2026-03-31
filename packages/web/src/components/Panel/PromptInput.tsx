import { useState, useRef } from "react";

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
}

export function PromptInput({ onSubmit, disabled }: PromptInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        padding: "12px",
        borderTop: "1px solid #1a1a3e",
        display: "flex",
        gap: "8px",
        alignItems: "flex-end",
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Minion is working..." : "Give your minion a task..."}
        disabled={disabled}
        rows={2}
        style={{
          flex: 1,
          background: "#0f0f23",
          border: "1px solid #2a2a4a",
          borderRadius: "8px",
          padding: "10px 14px",
          color: "#e0e0e0",
          fontFamily: "'Inter', sans-serif",
          fontSize: "13px",
          resize: "none",
          outline: "none",
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        style={{
          background: disabled ? "#2a2a4a" : "#7c3aed",
          color: "white",
          border: "none",
          borderRadius: "8px",
          padding: "10px 18px",
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: 600,
          fontSize: "13px",
          opacity: disabled || !value.trim() ? 0.5 : 1,
          transition: "all 0.15s",
        }}
      >
        Send
      </button>
    </div>
  );
}
