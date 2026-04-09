import { useEffect, useRef } from "react";
import { useStore } from "../store";

export function useNotifications() {
  const { minions } = useStore();
  const prevStatuses = useRef<Record<string, string>>({});
  const permissionGranted = useRef(false);

  // Request notification permission on first user interaction
  useEffect(() => {
    function requestPermission() {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then((perm) => {
          permissionGranted.current = perm === "granted";
        });
      } else if ("Notification" in window && Notification.permission === "granted") {
        permissionGranted.current = true;
      }
      window.removeEventListener("click", requestPermission);
    }
    window.addEventListener("click", requestPermission);
    return () => window.removeEventListener("click", requestPermission);
  }, []);

  useEffect(() => {
    if (!permissionGranted.current) return;
    if (!("Notification" in window)) return;

    for (const m of minions) {
      const prev = prevStatuses.current[m.id];
      if (prev === "working" && m.status === "idle") {
        // Only notify if page is not focused
        if (document.hidden) {
          new Notification(`${m.name} selesai!`, {
            body: "Task completed successfully.",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>🎭</text></svg>",
          });
        }
      } else if (m.status === "error" && prev !== "error") {
        if (document.hidden) {
          new Notification(`${m.name} error`, {
            body: "Something went wrong.",
          });
        }
      }
      prevStatuses.current[m.id] = m.status;
    }
  }, [minions]);
}
