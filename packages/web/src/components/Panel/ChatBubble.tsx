import { useState, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ChatMessage } from "../../types";

interface ChatBubbleProps {
  message: ChatMessage;
  accentColor: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        background: copied ? "#4CAF50" : "rgba(0,0,0,0.06)",
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: "4px",
        padding: "2px 8px",
        fontSize: "10px",
        color: copied ? "white" : "#666",
        cursor: "pointer",
        fontFamily: "'Inter', sans-serif",
        transition: "all 0.15s ease",
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ToolBubble({
  message,
  accentColor,
}: {
  message: ChatMessage;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = message.content;
  const isLong = content.length > 120;

  return (
    <div
      style={{
        padding: "2px 16px",
        display: "flex",
        justifyContent: "flex-start",
      }}
    >
      <div
        style={{
          background: "#F5F5F5",
          border: "1px solid #E0E0E0",
          borderRadius: "8px",
          padding: "4px 10px",
          fontSize: "11px",
          color: "#666",
          fontFamily: "'JetBrains Mono', monospace",
          maxWidth: "90%",
          cursor: isLong ? "pointer" : "default",
        }}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <span style={{ color: accentColor, fontWeight: 600 }}>
          {message.toolName || "tool"}
        </span>{" "}
        {isLong && !expanded ? content.slice(0, 120) + "..." : content}
        {isLong && (
          <span
            style={{
              color: accentColor,
              fontSize: "10px",
              marginLeft: "6px",
              opacity: 0.8,
            }}
          >
            {expanded ? "▲ collapse" : "▼ expand"}
          </span>
        )}
      </div>
    </div>
  );
}

// Dark code theme for user bubbles (light text on dark bg)
const userCodeStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.2)",
  borderRadius: "6px",
  padding: "8px 10px",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  overflowX: "auto",
  margin: "6px 0",
  whiteSpace: "pre-wrap",
  color: "rgba(255,255,255,0.9)",
};

export const ChatBubble = memo(function ChatBubble({ message, accentColor }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool) {
    return <ToolBubble message={message} accentColor={accentColor} />;
  }

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        padding: "4px 16px",
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? accentColor : "#FFFFFF",
          color: isUser ? "white" : "#333",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          padding: "10px 14px",
          fontSize: "13px",
          lineHeight: "1.5",
          fontFamily: "'Inter', sans-serif",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          wordBreak: "break-word",
        }}
      >
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const codeString = String(children).replace(/\n$/, "");
                const isInline = !className && !codeString.includes("\n");

                if (isInline) {
                  return (
                    <code
                      style={{
                        background: isUser
                          ? "rgba(0,0,0,0.2)"
                          : "rgba(0,0,0,0.06)",
                        borderRadius: "3px",
                        padding: "1px 4px",
                        fontSize: "12px",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                if (isUser) {
                  return (
                    <div style={{ position: "relative" }}>
                      <CopyButton text={codeString} />
                      <pre style={userCodeStyle}>
                        <code>{codeString}</code>
                      </pre>
                    </div>
                  );
                }

                return (
                  <div style={{ position: "relative", margin: "6px 0" }}>
                    <CopyButton text={codeString} />
                    <SyntaxHighlighter
                      style={oneLight}
                      language={match?.[1] || "text"}
                      PreTag="div"
                      customStyle={{
                        borderRadius: "6px",
                        fontSize: "12px",
                        margin: 0,
                        padding: "8px 10px",
                        paddingTop: "24px",
                      }}
                      codeTagProps={{
                        style: {
                          fontFamily: "'JetBrains Mono', monospace",
                        },
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  </div>
                );
              },
              p({ children }) {
                return (
                  <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>
                    {children}
                  </p>
                );
              },
              ul({ children }) {
                return (
                  <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
                    {children}
                  </ul>
                );
              },
              ol({ children }) {
                return (
                  <ol style={{ margin: "4px 0", paddingLeft: "20px" }}>
                    {children}
                  </ol>
                );
              },
              table({ children }) {
                return (
                  <div style={{ overflowX: "auto", margin: "6px 0" }}>
                    <table
                      style={{
                        borderCollapse: "collapse",
                        fontSize: "12px",
                        width: "100%",
                      }}
                    >
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th
                    style={{
                      border: "1px solid #ddd",
                      padding: "4px 8px",
                      background: isUser
                        ? "rgba(0,0,0,0.1)"
                        : "rgba(0,0,0,0.04)",
                      textAlign: "left",
                    }}
                  >
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td
                    style={{
                      border: "1px solid #ddd",
                      padding: "4px 8px",
                    }}
                  >
                    {children}
                  </td>
                );
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: isUser ? "rgba(255,255,255,0.9)" : accentColor,
                      textDecoration: "underline",
                    }}
                  >
                    {children}
                  </a>
                );
              },
              blockquote({ children }) {
                return (
                  <blockquote
                    style={{
                      borderLeft: `3px solid ${isUser ? "rgba(255,255,255,0.4)" : accentColor}`,
                      margin: "6px 0",
                      padding: "2px 10px",
                      opacity: 0.85,
                    }}
                  >
                    {children}
                  </blockquote>
                );
              },
              strong({ children }) {
                return <strong style={{ fontWeight: 600 }}>{children}</strong>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        <div
          style={{
            fontSize: "10px",
            opacity: 0.5,
            marginTop: "4px",
            textAlign: "right",
          }}
        >
          {time}
        </div>
      </div>
    </div>
  );
});
