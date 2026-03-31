import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const { setMinions, updateMinionStatus } = useStore();

  useEffect(() => {
    const socket = io("/", { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[socket] connected");
    });

    socket.on("minions:list", (list) => {
      setMinions(list);
    });

    socket.on("minion:status", ({ minionId, status }) => {
      updateMinionStatus(minionId, status);
    });

    socket.on("disconnect", () => {
      console.log("[socket] disconnected");
    });

    return () => {
      socket.disconnect();
    };
  }, [setMinions, updateMinionStatus]);

  const sendPrompt = (minionId: string, prompt: string) => {
    socketRef.current?.emit("minion:prompt", { minionId, prompt });
  };

  const stopMinion = (minionId: string) => {
    socketRef.current?.emit("minion:stop", { minionId });
  };

  return { socket: socketRef, sendPrompt, stopMinion };
}
