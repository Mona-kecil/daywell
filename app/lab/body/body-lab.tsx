"use client";
import { useState } from "react";
import { BodyModel, type MuscleKey, type MuscleState } from "@/components/body3d";
import { ThemeToggle } from "@/components/tracker";

const STATES: Partial<Record<MuscleKey, MuscleState>> = {
  chest: { kind: "recovering", fraction: 0.15, label: "Ready in 61h 12m" },
  back: { kind: "ready", fraction: 1, label: "Ready" },
  shoulders: { kind: "recovering", fraction: 0.45, label: "Ready in 26h 24m" },
  biceps: { kind: "ready", fraction: 1, label: "Ready" },
  triceps: { kind: "recovering", fraction: 0.2, label: "Ready in 38h 0m" },
  forearms: { kind: "ready", fraction: 1, label: "Ready" },
  abs: { kind: "recovering", fraction: 0.7, label: "Ready in 7h 12m" },
  quads: { kind: "recovering", fraction: 0.05, label: "Ready in 68h 24m" },
  hamstrings: { kind: "recovering", fraction: 0.55, label: "Ready in 32h 24m" },
  glutes: { kind: "recovering", fraction: 0.85, label: "Ready in 10h 48m" },
};

export function BodyLab() {
  const [selected, setSelected] = useState<MuscleKey[]>([]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <strong>Body lab</strong>
        <ThemeToggle />
      </header>
      <main id="main-content" style={{ padding: 16 }}>
        <BodyModel
          states={STATES}
          selected={selected}
          onToggle={(k) =>
            setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
          }
        />
        <p data-testid="selected">{selected.join(", ") || "none"}</p>
      </main>
    </div>
  );
}
