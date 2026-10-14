"use client";
import { useConvexConnectionState } from "convex/react";
import { CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Short drops reconnect on their own; only say something after this long.
export const OFFLINE_AFTER_MS = 2000;
export const SAVED_FOR_MS = 2500;

type Phase = "online" | "offline" | "syncing" | "saved";

const changes = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

// Convex keeps mutations made while offline and sends them on reconnect, but
// a tap that seems to do nothing gets tapped again. This says the change is
// waiting, and when it has landed.
export function ConnectionStatus() {
  const state = useConvexConnectionState();
  const pending = state.inflightMutations + state.inflightActions;
  const down = state.hasEverConnected && !state.isWebSocketConnected;
  // Set once a drop has lasted long enough to mention; cleared a moment
  // after everything has synced.
  const [alerted, setAlerted] = useState(false);
  const phase: Phase = !alerted
    ? "online"
    : down
      ? "offline"
      : pending
        ? "syncing"
        : "saved";
  const pill = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (down && !alerted) {
      const t = setTimeout(() => setAlerted(true), OFFLINE_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (phase === "saved") {
      const t = setTimeout(() => setAlerted(false), SAVED_FOR_MS);
      return () => clearTimeout(t);
    }
  }, [down, alerted, phase]);

  const shown = phase !== "online";
  useEffect(() => {
    const el = pill.current;
    if (!el?.showPopover) return;
    if (shown && !el.matches(":popover-open")) el.showPopover();
    if (!shown && el.matches(":popover-open")) el.hidePopover();
  }, [shown]);

  const browserOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  let icon = <CloudOff size={16} aria-hidden />;
  let text = browserOffline ? "You're offline" : "Can't reach Daywell";
  if (phase === "offline")
    text += pending
      ? ` · ${changes(pending)} waiting to sync`
      : " · Reconnecting…";
  if (phase === "syncing") {
    icon = <RefreshCw size={16} aria-hidden className="spin" />;
    text = `Back online · syncing ${changes(pending)}…`;
  }
  if (phase === "saved") {
    icon = <CloudCheck size={16} aria-hidden />;
    text = "Back online · everything is saved";
  }

  return (
    <div
      ref={pill}
      popover="manual"
      role="status"
      className={`connection-pill ${phase}`}
    >
      {shown && (
        <>
          {icon}
          <span>{text}</span>
        </>
      )}
    </div>
  );
}
