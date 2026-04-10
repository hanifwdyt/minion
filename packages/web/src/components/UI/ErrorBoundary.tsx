import { Component, type ReactNode } from "react";
import { IconWarning } from "./Icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label || "unknown"}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: "12px",
            padding: "24px",
            color: "#666",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <div style={{ color: "#b59a6a", opacity: 0.7 }}><IconWarning size={32} /></div>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>
            {this.props.label || "Component"} error
          </div>
          <div style={{ fontSize: "12px", color: "#999", textAlign: "center", maxWidth: 300 }}>
            {this.state.error?.message || "Something went wrong"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              background: "#5D4037",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
