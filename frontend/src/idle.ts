// Automatyczne wylogowanie po bezczynności (jak na serwerze: APT_SESSION_IDLE_MINUTES).
// Aktywność (ruch myszy, klawiatura, dotyk) jest wspólna dla wszystkich kart przeglądarki.
import { useEffect } from "react";
import { notifications } from "@mantine/notifications";

import { api } from "./api";

const KEY = "apt-last-activity";
const PING_EVERY_MS = 5 * 60_000; // przy aktywności odświeżamy sesję na serwerze co 5 min
const WARN_BEFORE_MS = 60_000;

function readShared(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(t: number) {
  try {
    localStorage.setItem(KEY, String(t));
  } catch {
    /* tryb prywatny */
  }
}

export function useIdleLogout(enabled: boolean, idleMinutes: number, onIdle: () => void) {
  useEffect(() => {
    if (!enabled || !idleMinutes) return;
    const idleMs = idleMinutes * 60_000;
    let last = Date.now();
    let lastPing = Date.now();
    let warned = false;
    writeShared(last);

    const activity = () => {
      const now = Date.now();
      if (now - last < 5_000) return;
      last = now;
      writeShared(now);
      if (warned) {
        notifications.hide("idle-warning");
        warned = false;
      }
      if (now - lastPing > PING_EVERY_MS) {
        lastPing = now;
        api("/auth/me").catch(() => undefined);
      }
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));

    const timer = window.setInterval(() => {
      const lastAny = Math.max(last, readShared());
      const idle = Date.now() - lastAny;
      if (idle >= idleMs) {
        window.clearInterval(timer);
        onIdle();
      } else if (idle >= idleMs - WARN_BEFORE_MS && !warned) {
        warned = true;
        notifications.show({
          id: "idle-warning",
          color: "orange",
          autoClose: false,
          title: "Brak aktywności",
          message: "Za minutę nastąpi automatyczne wylogowanie. Porusz myszą lub naciśnij klawisz, aby zostać.",
        });
      }
    }, 10_000);

    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [enabled, idleMinutes, onIdle]);
}
