import { useState, useEffect } from "react";

/** Jakarta WIB = UTC+7. Sleep window: 23:00–05:00 WIB */
function getJakartaHour(): number {
  return (new Date().getUTCHours() + 7) % 24;
}

function isSleepHour(): boolean {
  const h = getJakartaHour();
  return h >= 23 || h < 5;
}

export function useSleepMode(): boolean {
  const [sleeping, setSleeping] = useState(isSleepHour);

  useEffect(() => {
    const iv = setInterval(() => setSleeping(isSleepHour()), 60_000);
    return () => clearInterval(iv);
  }, []);

  return sleeping;
}
