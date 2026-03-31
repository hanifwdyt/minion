import { useStore } from "../../store";

export function TopBar() {
  const { minions } = useStore();
  const workingCount = minions.filter((m) => m.status === "working").length;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "48px",
        background: "rgba(10, 10, 15, 0.85)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #1a1a3e",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "20px" }}>🤖</span>
        <span style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.5px" }}>
          MINION
        </span>
        <span style={{ fontSize: "11px", color: "#666", fontWeight: 500 }}>
          AI Agent Workspace
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {/* Minion status dots */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {minions.map((m) => (
            <div
              key={m.id}
              title={`${m.name} - ${m.status}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  m.status === "working"
                    ? "#2ecc71"
                    : m.status === "error"
                    ? "#e74c3c"
                    : "#444",
                transition: "background 0.3s",
                boxShadow: m.status === "working" ? "0 0 6px #2ecc71" : "none",
              }}
            />
          ))}
        </div>

        {workingCount > 0 && (
          <span
            style={{
              fontSize: "12px",
              color: "#2ecc71",
              fontWeight: 600,
            }}
          >
            {workingCount} working
          </span>
        )}
      </div>
    </div>
  );
}
