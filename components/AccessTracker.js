"use client";

import { useEffect } from "react";

export default function AccessTracker() {
  useEffect(() => {
    if (window.location.pathname.startsWith("/login")) return;

    let stopped = false;

    async function heartbeat() {
      if (stopped) return;

      try {
        await fetch("/api/access/heartbeat", {
          method: "POST",
          keepalive: true,
        });
      } catch {
        // O relatorio de acesso nao deve atrapalhar o uso do sistema.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden" || document.visibilityState === "visible") {
        heartbeat();
      }
    }

    heartbeat();
    const interval = window.setInterval(heartbeat, 60000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", heartbeat);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", heartbeat);
    };
  }, []);

  return null;
}