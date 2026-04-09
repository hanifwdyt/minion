import { useEffect, useState } from "react";

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

let toastListener: ((toast: Toast) => void) | null = null;

export function toast(type: Toast["type"], message: string) {
  const t: Toast = { id: `toast-${Date.now()}-${Math.random()}`, type, message };
  toastListener?.(t);
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 4000);
    };
    return () => { toastListener = null; };
  }, []);

  if (toasts.length === 0) return null;

  const colors = {
    success: { bg: "#E8F5E9", border: "#4CAF50", text: "#2E7D32" },
    error: { bg: "#FFF0F0", border: "#E53935", text: "#C62828" },
    info: { bg: "#E3F2FD", border: "#1976D2", text: "#1565C0" },
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 60,
        right: 20,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => {
        const c = colors[t.type];
        return (
          <div
            key={t.id}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              color: c.text,
              padding: "10px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              animation: "fadeIn 0.2s ease",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
              style={{
                background: "none", border: "none", color: c.text,
                cursor: "pointer", fontSize: 14, padding: "2px 4px",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
