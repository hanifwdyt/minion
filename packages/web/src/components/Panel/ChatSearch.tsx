import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "../../types";

interface ChatSearchProps {
  messages: ChatMessage[];
  onClose: () => void;
  onExport: () => void;
  accentColor: string;
}

export function ChatSearch({ messages, onClose, onExport, accentColor }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = query.trim()
    ? messages.filter((m) =>
        m.role !== "tool" && m.content.toLowerCase().includes(query.toLowerCase())
      ).length
    : 0;

  return (
    <div style={{
      padding: "8px 16px",
      borderBottom: "1px solid #E8E8E8",
      background: "#FAFAFA",
      display: "flex",
      gap: 8,
      alignItems: "center",
    }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages..."
        aria-label="Search messages"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        style={{
          flex: 1, padding: "6px 10px", borderRadius: 6,
          border: "1px solid #E0E0E0", fontSize: 12,
          outline: "none", fontFamily: "'Inter', sans-serif",
        }}
      />
      {query && (
        <span style={{ fontSize: 11, color: "#888", flexShrink: 0 }}>
          {matches} found
        </span>
      )}
      <button
        onClick={onExport}
        aria-label="Export chat"
        title="Export as Markdown"
        style={{
          background: "none", border: "1px solid #E0E0E0",
          borderRadius: 6, padding: "4px 8px",
          cursor: "pointer", fontSize: 12, color: "#666",
        }}
      >
        Export
      </button>
      <button
        onClick={onClose}
        aria-label="Close search"
        style={{
          background: "none", border: "none", color: "#999",
          cursor: "pointer", fontSize: 14, padding: "4px",
        }}
      >
        ×
      </button>
    </div>
  );
}

// Highlight matching text in content
export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "#FFEB3B", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : part
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Export chat as markdown
export function exportChatMarkdown(messages: ChatMessage[], minionName: string): void {
  const lines = [`# Chat with ${minionName}`, `Exported: ${new Date().toISOString()}`, ""];

  for (const msg of messages) {
    if (msg.role === "tool") continue;
    const time = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === "user" ? "You" : minionName;
    lines.push(`### ${role} — ${time}`);
    lines.push(msg.content);
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${minionName.toLowerCase()}-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
