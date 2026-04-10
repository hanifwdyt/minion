import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store";
import { toast } from "../components/UI/Toaster";
import type { ChatMessage } from "../types";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const workingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const {
    setMinions, updateMinionStatus, addChatMessage, updateChatMessage,
    setConnected, setChatHistory, clearChat, addActivity, setActivityEvents,
  } = useStore();

  useEffect(() => {
    const socket = io("/", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      toast("success", "Connected to server");
    });

    socket.on("minions:list", (list) => setMinions(list));

    socket.on("chat:history", (history: Record<string, ChatMessage[]>) => {
      setChatHistory(history);
    });

    socket.on("minion:status", ({ minionId, status }) => {
      updateMinionStatus(minionId, status);

      // Timeout warning: if minion works > 30s, show warning
      if (status === "working") {
        const timer = setTimeout(() => {
          addChatMessage(minionId, {
            id: `timeout-warn-${Date.now()}`,
            minionId,
            role: "assistant",
            content: "_Taking longer than usual... Still working._",
            timestamp: Date.now(),
          });
        }, 30000);
        workingTimers.current.set(minionId, timer);
      } else {
        // Clear timeout warning
        const timer = workingTimers.current.get(minionId);
        if (timer) {
          clearTimeout(timer);
          workingTimers.current.delete(minionId);
        }

        // Show error in chat if status is error
        if (status === "error") {
          addChatMessage(minionId, {
            id: `err-${Date.now()}`,
            minionId,
            role: "assistant",
            content: "Something went wrong. Try again or check the activity feed.",
            timestamp: Date.now(),
          });
          toast("error", `${minionId} encountered an error`);
        }
      }
    });

    socket.on("minion:chat", ({ minionId, message }: { minionId: string; message: ChatMessage }) => {
      addChatMessage(minionId, message);
    });

    socket.on("minion:chat:delta", ({ minionId, messageId, content }: { minionId: string; messageId: string; content: string }) => {
      updateChatMessage(minionId, messageId, content);
    });

    socket.on("activity:history", (events: any[]) => setActivityEvents(events));
    socket.on("activity:new", (event: any) => addActivity(event));

    // Forward task events to window for TaskProgress component
    socket.on("task:start", (data: any) => {
      window.dispatchEvent(new CustomEvent("task:start", { detail: data }));
    });
    socket.on("task:step", (data: any) => {
      window.dispatchEvent(new CustomEvent("task:step", { detail: data }));
    });
    socket.on("task:done", (data: any) => {
      window.dispatchEvent(new CustomEvent("task:done", { detail: data }));
    });

    socket.on("disconnect", () => {
      setConnected(false);
      toast("error", "Disconnected — reconnecting...");
    });

    socket.on("reconnect", () => {
      setConnected(true);
      toast("success", "Reconnected!");
    });

    return () => {
      // Cleanup all timers
      for (const timer of workingTimers.current.values()) clearTimeout(timer);
      workingTimers.current.clear();
      socket.disconnect();
    };
  }, [setMinions, updateMinionStatus, addChatMessage, updateChatMessage, setConnected, setChatHistory, addActivity, setActivityEvents]);

  const sendPrompt = useCallback((minionId: string, prompt: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      minionId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    addChatMessage(minionId, userMessage);
    socketRef.current?.emit("minion:prompt", { minionId, prompt });
  }, [addChatMessage]);

  const stopMinion = useCallback((minionId: string) => {
    socketRef.current?.emit("minion:stop", { minionId });
  }, []);

  const clearMinionChat = useCallback((minionId: string) => {
    clearChat(minionId);
    socketRef.current?.emit("minion:clear", { minionId });
  }, [clearChat]);

  return { sendPrompt, stopMinion, clearMinionChat };
}
