import { useState, useCallback, useEffect, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ChatMessage } from "../../types";
import { colors, fonts, fontSize, radius, spacing, shadows, glass, transition } from "../../styles/tokens";

// ─── Gold-tinted dark syntax theme ───────────────────────────────────────────
const goldDarkTheme: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] || {}),
    background: "#0d0a08",
    margin: 0,
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] || {}),
    background: "#0d0a08",
    color: colors.parchment,
    fontFamily: fonts.mono,
  },
  comment: { color: "#6B5D4D", fontStyle: "italic" },
  prolog: { color: "#6B5D4D" },
  punctuation: { color: "#9E8B72" },
  property: { color: colors.goldBright },
  tag: { color: "#CC6B30" },
  boolean: { color: colors.goldBright },
  number: { color: colors.goldBright },
  constant: { color: colors.goldBright },
  symbol: { color: colors.goldBright },
  selector: { color: "#5A9E6F" },
  "attr-name": { color: colors.gold },
  string: { color: "#5A9E6F" },
  char: { color: "#5A9E6F" },
  builtin: { color: colors.gold },
  operator: { color: "#9E8B72" },
  entity: { color: colors.gold },
  url: { color: "#6B8DA6" },
  keyword: { color: "#CC6B30" },
  regex: { color: "#D4A043" },
  important: { color: "#D4A043", fontWeight: "bold" },
  atrule: { color: colors.gold },
  "attr-value": { color: "#5A9E6F" },
  function: { color: colors.goldBright },
  "class-name": { color: colors.goldBright },
};

// ─── Keyframes (injected once) ───────────────────────────────────────────────
const STYLE_ID = "chat-bubble-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes cb-fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes cb-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes cb-goldPulse {
      0%, 100% { opacity: 0.4; }
      50%      { opacity: 1; }
    }
    .cb-timestamp {
      opacity: 0;
      transition: opacity ${transition.fast};
    }
    .cb-bubble-wrap:hover .cb-timestamp {
      opacity: 0.6;
    }
    .cb-copy-btn:hover {
      background: rgba(200, 163, 90, 0.35) !important;
      color: ${colors.goldBright} !important;
      transform: scale(1.05);
    }
    .cb-tool-card:hover {
      border-color: ${colors.goldBorder} !important;
      background: rgba(42, 33, 24, 0.6) !important;
    }
    .cb-tool-toggle:hover {
      color: ${colors.goldBright} !important;
    }
    .cb-cmd-hint:hover {
      background: rgba(200, 163, 90, 0.08) !important;
    }
  `;
  document.head.appendChild(style);
}

// ─── Relative time helper ────────────────────────────────────────────────────
function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Copy Button ─────────────────────────────────────────────────────────────
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
      className="cb-copy-btn"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        background: copied ? "rgba(90, 158, 111, 0.3)" : "rgba(200, 163, 90, 0.15)",
        border: `1px solid ${copied ? "rgba(90, 158, 111, 0.4)" : colors.goldBorder}`,
        borderRadius: radius.sm,
        padding: "3px 10px",
        fontSize: fontSize.xs,
        color: copied ? colors.success : colors.textSecondary,
        cursor: "pointer",
        fontFamily: fonts.mono,
        transition: `all ${transition.fast}`,
        zIndex: 2,
        lineHeight: 1.4,
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Tool Bubble ─────────────────────────────────────────────────────────────
function ToolBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const content = message.content;
  const toolName = message.toolName || "tool";
  const isLong = content.length > 100;

  // Determine status from content heuristics
  const isDone = content.includes("✓") || content.includes("done") || content.includes("result") || content.length > 0;
  const isWorking = content === "" || content === "...";

  return (
    <div
      style={{
        padding: `${spacing.xs}px ${spacing.lg}px`,
        display: "flex",
        justifyContent: "flex-start",
        animation: "cb-fadeInUp 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}
    >
      <div
        className="cb-tool-card"
        onClick={() => isLong && setExpanded(!expanded)}
        style={{
          ...glass.card,
          borderRadius: radius.md,
          padding: `${spacing.sm}px ${spacing.md}px`,
          maxWidth: "92%",
          cursor: isLong ? "pointer" : "default",
          transition: `all ${transition.fast}`,
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          {/* Status indicator */}
          {isWorking ? (
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                border: `2px solid ${colors.goldDim}`,
                borderTopColor: colors.gold,
                borderRadius: "50%",
                animation: "cb-spin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "rgba(90, 158, 111, 0.15)",
                color: colors.success,
                fontSize: 10,
                flexShrink: 0,
                fontWeight: 700,
              }}
            >
              ✓
            </span>
          )}

          {/* Tool icon + name badge */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: colors.goldGlow,
              border: `1px solid ${colors.goldBorder}`,
              borderRadius: radius.sm,
              padding: "2px 8px",
              fontSize: fontSize.xs,
              fontFamily: fonts.mono,
              fontWeight: 600,
              color: colors.gold,
              letterSpacing: "0.02em",
            }}
          >
            <span style={{ fontSize: 10, opacity: 0.7 }}>⚙</span>
            {toolName}
          </span>

          {/* Expand/collapse toggle */}
          {isLong && (
            <button
              className="cb-tool-toggle"
              style={{
                background: "none",
                border: "none",
                color: colors.textSecondary,
                fontSize: fontSize.xs,
                fontFamily: fonts.sans,
                cursor: "pointer",
                padding: "0 4px",
                marginLeft: "auto",
                transition: `color ${transition.fast}`,
              }}
            >
              {expanded ? "▲ collapse" : "▼ expand"}
            </button>
          )}
        </div>

        {/* Content */}
        {(content && !isWorking) && (
          <div
            style={{
              marginTop: spacing.xs,
              fontSize: fontSize.xs,
              fontFamily: fonts.mono,
              color: colors.textSecondary,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "hidden",
              maxHeight: isLong && !expanded ? 48 : undefined,
            }}
          >
            {isLong && !expanded ? content.slice(0, 100) + "..." : content}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ChatBubble Props ────────────────────────────────────────────────────────
interface ChatBubbleProps {
  message: ChatMessage;
  accentColor: string;
  index?: number;
}

// ─── Main Component ──────────────────────────────────────────────────────────
export const ChatBubble = memo(function ChatBubble({ message, accentColor: _ac, index = 0 }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const ref = useRef<HTMLDivElement>(null);

  // Inject keyframes once
  useEffect(() => {
    ensureKeyframes();
  }, []);

  if (isTool) {
    return <ToolBubble message={message} />;
  }

  const staggerDelay = Math.min(index * 40, 200);

  // ── Bubble styles ──
  const bubbleBg = isUser
    ? `linear-gradient(135deg, rgba(200, 163, 90, 0.35) 0%, rgba(200, 163, 90, 0.2) 100%)`
    : undefined;
  const bubbleBgColor = isUser ? undefined : glass.card.background;
  const bubbleColor = isUser ? colors.parchment : colors.text;
  const bubbleBorderRadius = isUser
    ? `${radius.lg}px ${radius.lg}px ${radius.sm}px ${radius.lg}px`
    : `${radius.lg}px ${radius.lg}px ${radius.lg}px ${radius.sm}px`;

  return (
    <div
      ref={ref}
      className="cb-bubble-wrap"
      style={{
        padding: `${spacing.xs}px ${spacing.lg}px`,
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        animation: `cb-fadeInUp 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${staggerDelay}ms both`,
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          background: bubbleBg || bubbleBgColor,
          backdropFilter: isUser ? undefined : glass.card.backdropFilter,
          WebkitBackdropFilter: isUser ? undefined : glass.card.WebkitBackdropFilter,
          border: isUser
            ? `1px solid rgba(200, 163, 90, 0.25)`
            : glass.card.border,
          color: bubbleColor,
          borderRadius: bubbleBorderRadius,
          padding: `${spacing.sm + 2}px ${spacing.lg}px`,
          fontSize: fontSize.md,
          lineHeight: 1.65,
          fontFamily: fonts.sans,
          boxShadow: isUser ? shadows.sm : shadows.md,
          wordBreak: "break-word",
          position: "relative",
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
                          ? "rgba(200, 163, 90, 0.2)"
                          : "rgba(200, 163, 90, 0.1)",
                        border: `1px solid ${isUser ? "rgba(200, 163, 90, 0.15)" : "rgba(200, 163, 90, 0.08)"}`,
                        borderRadius: radius.sm - 2,
                        padding: "1px 6px",
                        fontSize: fontSize.sm,
                        fontFamily: fonts.mono,
                        color: isUser ? colors.parchment : colors.gold,
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <div
                    style={{
                      position: "relative",
                      margin: `${spacing.sm}px 0`,
                      borderRadius: radius.md,
                      overflow: "hidden",
                      border: `1px solid ${colors.glassBorder}`,
                    }}
                  >
                    {/* Language label */}
                    {match?.[1] && (
                      <div
                        style={{
                          background: "rgba(200, 163, 90, 0.08)",
                          padding: `${spacing.xs}px ${spacing.sm + 2}px`,
                          fontSize: fontSize.xs,
                          fontFamily: fonts.mono,
                          color: colors.goldDim,
                          borderBottom: `1px solid ${colors.glassBorder}`,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{match[1]}</span>
                      </div>
                    )}
                    <CopyButton text={codeString} />
                    <SyntaxHighlighter
                      style={goldDarkTheme}
                      language={match?.[1] || "text"}
                      PreTag="div"
                      customStyle={{
                        borderRadius: 0,
                        fontSize: fontSize.sm,
                        margin: 0,
                        padding: `${spacing.md}px ${spacing.md}px`,
                        paddingTop: match?.[1] ? spacing.md : spacing.xl,
                        background: "#0d0a08",
                      }}
                      codeTagProps={{
                        style: {
                          fontFamily: fonts.mono,
                          lineHeight: 1.6,
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
                  <p
                    style={{
                      margin: `${spacing.xs}px 0`,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.65,
                    }}
                  >
                    {children}
                  </p>
                );
              },
              ul({ children }) {
                return (
                  <ul
                    style={{
                      margin: `${spacing.xs}px 0`,
                      paddingLeft: spacing.xl,
                      lineHeight: 1.65,
                    }}
                  >
                    {children}
                  </ul>
                );
              },
              ol({ children }) {
                return (
                  <ol
                    style={{
                      margin: `${spacing.xs}px 0`,
                      paddingLeft: spacing.xl,
                      lineHeight: 1.65,
                    }}
                  >
                    {children}
                  </ol>
                );
              },
              li({ children }) {
                return (
                  <li
                    style={{
                      marginBottom: 2,
                      paddingLeft: spacing.xs,
                    }}
                  >
                    {children}
                  </li>
                );
              },
              table({ children }) {
                return (
                  <div
                    style={{
                      overflowX: "auto",
                      margin: `${spacing.sm}px 0`,
                      borderRadius: radius.sm,
                      border: `1px solid ${colors.glassBorder}`,
                    }}
                  >
                    <table
                      style={{
                        borderCollapse: "collapse",
                        fontSize: fontSize.sm,
                        width: "100%",
                        fontFamily: fonts.sans,
                      }}
                    >
                      {children}
                    </table>
                  </div>
                );
              },
              thead({ children }) {
                return (
                  <thead
                    style={{
                      background: "rgba(200, 163, 90, 0.08)",
                    }}
                  >
                    {children}
                  </thead>
                );
              },
              th({ children }) {
                return (
                  <th
                    style={{
                      borderBottom: `1px solid ${colors.glassBorder}`,
                      padding: `${spacing.sm}px ${spacing.md}px`,
                      textAlign: "left",
                      fontWeight: 600,
                      color: colors.gold,
                      fontSize: fontSize.xs,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
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
                      borderBottom: `1px solid ${colors.borderLight}`,
                      padding: `${spacing.sm}px ${spacing.md}px`,
                      color: colors.text,
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
                      color: isUser ? colors.goldBright : colors.gold,
                      textDecoration: "none",
                      borderBottom: `1px solid ${isUser ? "rgba(232, 195, 106, 0.4)" : colors.goldBorder}`,
                      transition: `color ${transition.fast}, border-color ${transition.fast}`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = colors.goldBright;
                      e.currentTarget.style.borderBottomColor = colors.goldBright;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = isUser ? colors.goldBright : colors.gold;
                      e.currentTarget.style.borderBottomColor = isUser ? "rgba(232, 195, 106, 0.4)" : colors.goldBorder;
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
                      borderLeft: `3px solid ${isUser ? "rgba(200, 163, 90, 0.5)" : colors.gold}`,
                      margin: `${spacing.sm}px 0`,
                      padding: `${spacing.xs}px ${spacing.md}px`,
                      background: "rgba(200, 163, 90, 0.05)",
                      borderRadius: `0 ${radius.sm}px ${radius.sm}px 0`,
                      color: colors.textSecondary,
                      fontStyle: "italic",
                    }}
                  >
                    {children}
                  </blockquote>
                );
              },
              strong({ children }) {
                return (
                  <strong
                    style={{
                      fontWeight: 600,
                      color: isUser ? colors.parchment : colors.goldBright,
                    }}
                  >
                    {children}
                  </strong>
                );
              },
              em({ children }) {
                return (
                  <em style={{ color: colors.textSecondary, fontStyle: "italic" }}>
                    {children}
                  </em>
                );
              },
              hr() {
                return (
                  <hr
                    style={{
                      border: "none",
                      borderTop: `1px solid ${colors.glassBorder}`,
                      margin: `${spacing.md}px 0`,
                    }}
                  />
                );
              },
              h1({ children }) {
                return (
                  <h1
                    style={{
                      fontSize: fontSize.xl,
                      fontFamily: fonts.display,
                      fontWeight: 400,
                      color: colors.parchment,
                      margin: `${spacing.md}px 0 ${spacing.sm}px`,
                      lineHeight: 1.3,
                    }}
                  >
                    {children}
                  </h1>
                );
              },
              h2({ children }) {
                return (
                  <h2
                    style={{
                      fontSize: fontSize.lg,
                      fontFamily: fonts.display,
                      fontWeight: 400,
                      color: colors.parchment,
                      margin: `${spacing.md}px 0 ${spacing.xs}px`,
                      lineHeight: 1.3,
                    }}
                  >
                    {children}
                  </h2>
                );
              },
              h3({ children }) {
                return (
                  <h3
                    style={{
                      fontSize: fontSize.md,
                      fontWeight: 600,
                      color: colors.gold,
                      margin: `${spacing.sm}px 0 ${spacing.xs}px`,
                      lineHeight: 1.4,
                    }}
                  >
                    {children}
                  </h3>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Timestamp — show on hover */}
        <div
          className="cb-timestamp"
          style={{
            fontSize: fontSize.xs,
            color: isUser ? "rgba(245, 230, 211, 0.5)" : colors.textLight,
            marginTop: spacing.xs,
            textAlign: isUser ? "right" : "left",
            fontFamily: fonts.mono,
            letterSpacing: "0.02em",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {relativeTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
});
