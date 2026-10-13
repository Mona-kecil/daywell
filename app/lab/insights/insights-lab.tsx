"use client";
import { useMemo } from "react";
import { InsightsView } from "@/components/insights";
import { ThemeToggle } from "@/components/tracker";
import { HISTORY_DAYS, dayWindow, type InsightsInput } from "@/lib/insights";
import { MUSCLE_DEFAULTS } from "@/lib/recovery";

// Deterministic pseudo-random so screenshots are stable.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const SPLITS = [
  ["chest", "triceps", "shoulders"],
  ["back", "biceps", "forearms"],
  ["quads", "hamstrings", "glutes", "calves"],
  ["abs"],
];

function mock(period: ReturnType<typeof dayWindow>): InsightsInput {
  const r = rng(7);
  const muscles = MUSCLE_DEFAULTS.map((m) => ({ _id: m.name, name: m.name }));
  const data: InsightsInput = { waterGoal: 2500, muscles, water: [], meals: [], workouts: [] };
  let split = 0;
  period.days.forEach((d, i) => {
    const at = (h: number) => d.startMs + h * 3_600_000;
    if (r() > 0.12)
      for (let k = 0; k < 4 + Math.floor(r() * 6); k++)
        data.water.push({ at: at(8 + k * 1.5), amountMl: 300 + Math.round(r() * 4) * 50 });
    if (r() > 0.18)
      for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
        const protein = 20 + r() * 35, carbs = 30 + r() * 70, fat = 8 + r() * 25;
        data.meals.push({ at: at(8 + k * 4), protein, carbs, fat, kcal: protein * 4 + carbs * 4 + fat * 9 });
      }
    if (i % 7 !== 3 && r() > 0.45) {
      // Calves stay neglected so the "not trained" note has something to say.
      const ids = SPLITS[split++ % SPLITS.length].filter((m) => m !== "calves" || i < 20);
      data.workouts.push({ trainedAt: at(18), muscleIds: ids });
    }
  });
  return data;
}

export function InsightsLab() {
  const period = useMemo(() => dayWindow(new Date(), HISTORY_DAYS), []);
  const data = useMemo(() => mock(period), [period]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <strong>Insights lab</strong>
        <ThemeToggle />
      </header>
      <main id="main-content">
        <InsightsView data={data} period={period} />
      </main>
    </div>
  );
}
