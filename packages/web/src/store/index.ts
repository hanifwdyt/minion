import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MinionState, ChatMessage } from "../types";

// Punakawan default minions
const DEFAULT_MINIONS: MinionState[] = [
  {
    id: "semar",
    name: "Semar",
    role: "Tetua Bijak",
    color: "#DAA520",
    outfit: {
      shirtColor: "#8B6914",
      pantsColor: "#654321",
      skinColor: "#1a1a1a",
      hatStyle: "none",
      hatColor: "",
      shoeColor: "#3E2723",
    },
    workdir: ".",
    status: "idle",
  },
  {
    id: "gareng",
    name: "Gareng",
    role: "Sang Pemikir",
    color: "#CC5500",
    outfit: {
      shirtColor: "#CC5500",
      pantsColor: "#5D4037",
      skinColor: "#1a1a1a",
      hatStyle: "none",
      hatColor: "",
      shoeColor: "#3E2723",
    },
    workdir: ".",
    status: "idle",
  },
  {
    id: "petruk",
    name: "Petruk",
    role: "Sang Penghibur",
    color: "#8B1A1A",
    outfit: {
      shirtColor: "#8B1A1A",
      pantsColor: "#4E342E",
      skinColor: "#1a1a1a",
      hatStyle: "none",
      hatColor: "",
      shoeColor: "#3E2723",
    },
    workdir: ".",
    status: "idle",
  },
  {
    id: "bagong",
    name: "Bagong",
    role: "Sang Pekerja",
    color: "#1B5E20",
    outfit: {
      shirtColor: "#1B5E20",
      pantsColor: "#3E2723",
      skinColor: "#1a1a1a",
      hatStyle: "none",
      hatColor: "",
      shoeColor: "#3E2723",
    },
    workdir: ".",
    status: "idle",
  },
];

interface ActivityEvent {
  id: string;
  minionId: string;
  minionName: string;
  type: string;
  summary: string;
  timestamp: number;
}

interface AppStore {
  minions: MinionState[];
  selectedMinionId: string | null;
  panelOpen: boolean;
  chatMessages: Record<string, ChatMessage[]>;
  connected: boolean;
  activityEvents: ActivityEvent[];
  activityOpen: boolean;
  dashboardOpen: boolean;
  audioMuted: boolean;
  cameraMode: "overview" | "follow";

  setConnected: (connected: boolean) => void;
  setMinions: (minions: MinionState[]) => void;
  updateMinionStatus: (id: string, status: MinionState["status"]) => void;
  selectMinion: (id: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  addChatMessage: (minionId: string, message: ChatMessage) => void;
  updateChatMessage: (minionId: string, messageId: string, content: string) => void;
  setChatHistory: (history: Record<string, ChatMessage[]>) => void;
  clearChat: (minionId: string) => void;
  addActivity: (event: ActivityEvent) => void;
  setActivityEvents: (events: ActivityEvent[]) => void;
  setActivityOpen: (open: boolean) => void;
  setDashboardOpen: (open: boolean) => void;
  setAudioMuted: (muted: boolean) => void;
  setCameraMode: (mode: "overview" | "follow") => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      minions: DEFAULT_MINIONS,
      selectedMinionId: null,
      panelOpen: false,
      chatMessages: {},
      connected: false,
      activityEvents: [],
      activityOpen: false,
      dashboardOpen: false,
      audioMuted: true,
      cameraMode: "overview" as const,

      setConnected: (connected) => set({ connected }),
      setMinions: (minions) => set({ minions }),

      updateMinionStatus: (id, status) =>
        set((state) => ({
          minions: state.minions.map((m) =>
            m.id === id ? { ...m, status } : m
          ),
        })),

      selectMinion: (id) => set({ selectedMinionId: id ?? null, panelOpen: id !== null }),

      setPanelOpen: (open) =>
        set((state) => ({
          panelOpen: open,
          selectedMinionId: open ? state.selectedMinionId : null,
        })),

      addChatMessage: (minionId, message) =>
        set((state) => {
          const existing = state.chatMessages[minionId] || [];
          // Cap at 500 messages per minion to prevent localStorage bloat
          const updated = existing.length >= 500
            ? [...existing.slice(-499), message]
            : [...existing, message];
          return {
            chatMessages: { ...state.chatMessages, [minionId]: updated },
          };
        }),

      updateChatMessage: (minionId, messageId, content) =>
        set((state) => ({
          chatMessages: {
            ...state.chatMessages,
            [minionId]: (state.chatMessages[minionId] || []).map((msg) =>
              msg.id === messageId ? { ...msg, content } : msg
            ),
          },
        })),

      setChatHistory: (history) =>
        set((state) => ({
          chatMessages: { ...state.chatMessages, ...history },
        })),

      clearChat: (minionId) =>
        set((state) => ({
          chatMessages: {
            ...state.chatMessages,
            [minionId]: [],
          },
        })),

      addActivity: (event) =>
        set((state) => ({
          activityEvents: [...state.activityEvents.slice(-200), event],
        })),

      setActivityEvents: (events) => set({ activityEvents: events }),

      setActivityOpen: (open) => set({ activityOpen: open }),
      setDashboardOpen: (open) => set({ dashboardOpen: open }),
      setAudioMuted: (muted) => set({ audioMuted: muted }),
      setCameraMode: (mode) => set({ cameraMode: mode }),
    }),
    {
      name: "minion-chat-storage",
      partialize: (state) => ({
        chatMessages: state.chatMessages,
      }),
    }
  )
);
