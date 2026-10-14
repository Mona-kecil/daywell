"use client";
import { Share, SquarePlus, Smartphone } from "lucide-react";
import { useSyncExternalStore } from "react";
import { SectionTitle } from "./ui";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export type InstallMode = "installed" | "prompt" | "ios" | "none";

const KEY = "daywell.installDismissed";
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Chrome fires this once, often before the card mounts, so it is caught at
// load and kept for the Install button.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function installMode(): InstallMode {
  if (
    installed ||
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  )
    return "installed";
  if (deferred) return "prompt";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "none";
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};
const snapshot = () =>
  localStorage.getItem(KEY) === "1" ? "installed" : installMode();

// Offers a Home Screen install where the browser allows one. On iPhone it is
// also what lets reminders through, so the steps are spelled out there.
export function InstallCard() {
  const mode = useSyncExternalStore<InstallMode>(
    subscribe,
    snapshot,
    () => "installed",
  );
  if (mode === "installed" || mode === "none") return null;
  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    emit();
  };
  return (
    <section className="card install-card" aria-labelledby="install-title">
      <SectionTitle
        id="install-title"
        title="Put Daywell on your Home Screen"
        detail={
          mode === "ios"
            ? "It opens full screen like an app, and iPhone only sends reminders to apps on the Home Screen."
            : "It opens full screen like an app, straight from your Home Screen."
        }
        action={
          <span className="icon-tile green">
            <Smartphone size={22} />
          </span>
        }
      />
      {mode === "ios" && (
        <ol className="install-steps">
          <li>
            Tap <Share size={16} aria-label="Share" role="img" /> in the browser
            toolbar.
          </li>
          <li>
            Choose{" "}
            <strong>
              <SquarePlus size={16} aria-hidden /> Add to Home Screen
            </strong>
            .
          </li>
        </ol>
      )}
      <div className="install-actions">
        {mode === "prompt" && (
          <button
            type="button"
            className="primary-button"
            onClick={async () => {
              const event = deferred;
              if (!event) return;
              await event.prompt();
              const { outcome } = await event.userChoice;
              // The event can only be used once.
              deferred = null;
              if (outcome === "dismissed") dismiss();
              else emit();
            }}
          >
            Install Daywell
          </button>
        )}
        <button type="button" className="text-button" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
