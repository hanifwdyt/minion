import { create } from "zustand";
import type { MinionState } from "../types";

interface AppStore {
  minions: MinionState[];
  selectedMinionId: string | null;
  panelOpen: boolean;

  setMinions: (minions: MinionState[]) => void;
  updateMinionStatus: (id: string, status: MinionState["status"]) => void;
  selectMinion: (id: string | null) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useStore = create<AppStore>((set) => ({
  minions: [],
  selectedMinionId: null,
  panelOpen: false,

  setMinions: (minions) => set({ minions }),

  updateMinionStatus: (id, status) =>
    set((state) => ({
      minions: state.minions.map((m) =>
        m.id === id ? { ...m, status } : m
      ),
    })),

  selectMinion: (id) => set({ selectedMinionId: id, panelOpen: id !== null }),

  setPanelOpen: (open) =>
    set({ panelOpen: open, selectedMinionId: open ? undefined : null }),
}));
