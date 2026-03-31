import { useStore } from "../../store";
import { Terminal } from "./Terminal";
import { PromptInput } from "./PromptInput";
import type { Socket } from "socket.io-client";

interface SidePanelProps {
  socket: React.RefObject<Socket | null>;
  onSendPrompt: (minionId: string, prompt: string) => void;
  onStop: (minionId: string) => void;
}

export function SidePanel({ socket, onSendPrompt, onStop }: SidePanelProps) {
  const { minions, selectedMinionId, panelOpen, selectMinion } = useStore();
  const minion = minions.find((m) => m.id === selectedMinionId);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "480px",
        height: "100vh",
        background: "#0d0d1a",
        borderLeft: "1px solid #1a1a3e",
        transform: panelOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.3s ease",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #1a1a3e",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background:
                  minion?.status === "working"
                    ? "#2ecc71"
                    : minion?.status === "error"
                    ? "#e74c3c"
                    : "#636e72",
              }}
            />
            <span style={{ fontWeight: 700, fontSize: "15px" }}>
              {minion?.name ?? "Select a minion"}
            </span>
          </div>
          {minion && (
            <span
              style={{
                fontSize: "12px",
                color: "#888",
                marginLeft: "18px",
              }}
            >
              {minion.role}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {minion?.status === "working" && (
            <button
              onClick={() => minion && onStop(minion.id)}
              style={{
                background: "#e74c3c",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              Stop
            </button>
          )}
          <button
            onClick={() => selectMinion(null)}
            style={{
              background: "none",
              border: "1px solid #2a2a4a",
              color: "#888",
              borderRadius: "6px",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Terminal */}
      {minion && <Terminal minionId={minion.id} socket={socket} />}

      {/* Prompt input */}
      {minion && (
        <PromptInput
          onSubmit={(prompt) => onSendPrompt(minion.id, prompt)}
          disabled={minion.status === "working"}
        />
      )}
    </div>
  );
}
