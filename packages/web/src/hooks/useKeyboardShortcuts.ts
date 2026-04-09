import { useEffect } from "react";
import { useStore } from "../store";

export function useKeyboardShortcuts() {
  const { selectMinion, setDashboardOpen, setActivityOpen, minions, dashboardOpen, activityOpen, panelOpen } = useStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const mod = e.metaKey || e.ctrlKey;

      // Escape — close whatever is open (priority: dashboard > activity > panel)
      if (e.key === "Escape") {
        if (dashboardOpen) { setDashboardOpen(false); return; }
        if (activityOpen) { setActivityOpen(false); return; }
        if (panelOpen) { selectMinion(null); return; }
      }

      // Cmd/Ctrl + Shift + D — toggle dashboard
      if (mod && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setDashboardOpen(!dashboardOpen);
      }

      // Cmd/Ctrl + Shift + A — toggle activity feed
      if (mod && e.shiftKey && e.key === "A") {
        e.preventDefault();
        setActivityOpen(!activityOpen);
      }

      // Cmd/Ctrl + B — Balai Desa
      if (mod && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        selectMinion("balai");
      }

      // Cmd/Ctrl + 1-4 — select minion
      if (mod && !e.shiftKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (minions[idx]) selectMinion(minions[idx].id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectMinion, setDashboardOpen, setActivityOpen, minions, dashboardOpen, activityOpen, panelOpen]);
}
