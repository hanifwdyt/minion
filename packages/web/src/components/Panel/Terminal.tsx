import { useEffect, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Socket } from "socket.io-client";

interface TerminalProps {
  minionId: string;
  socket: React.RefObject<Socket | null>;
}

export function Terminal({ minionId, socket }: TerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerminal({
      theme: {
        background: "#0a0a1a",
        foreground: "#e0e0e0",
        cursor: "#7c3aed",
        selectionBackground: "#7c3aed40",
        black: "#1a1a2e",
        red: "#e74c3c",
        green: "#2ecc71",
        yellow: "#f39c12",
        blue: "#3498db",
        magenta: "#9b59b6",
        cyan: "#1abc9c",
        white: "#ecf0f1",
      },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    term.writeln("\x1b[36m╭─────────────────────────────────╮\x1b[0m");
    term.writeln("\x1b[36m│  🤖 Minion Terminal Ready       │\x1b[0m");
    term.writeln("\x1b[36m╰─────────────────────────────────╯\x1b[0m");
    term.writeln("");

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);

    // Listen for output from this minion
    const handleOutput = ({ minionId: id, data }: { minionId: string; data: string }) => {
      if (id === minionId) {
        term.write(data);
      }
    };

    const handleDone = ({ minionId: id }: { minionId: string }) => {
      if (id === minionId) {
        term.writeln("\n\x1b[32m✓ Task completed\x1b[0m\n");
      }
    };

    socket.current?.on("minion:output", handleOutput);
    socket.current?.on("minion:done", handleDone);

    return () => {
      socket.current?.off("minion:output", handleOutput);
      socket.current?.off("minion:done", handleDone);
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [minionId, socket]);

  return (
    <div
      ref={termRef}
      style={{
        flex: 1,
        minHeight: 0,
        padding: "4px",
      }}
    />
  );
}
