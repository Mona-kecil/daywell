"use client";
import { useQuery } from "convex/react";
import { Hourglass } from "lucide-react";
import { useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import {
  FASTING_GOALS,
  FASTING_KEY,
  duration,
  fastState,
  lastMealAt,
  readGoal,
} from "@/lib/fasting";
import { localDayRange } from "@/lib/day";
import { Burst, useCrossing } from "./celebrate";
import { SectionTitle, timeLabel } from "./ui";

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};
const setGoal = (goal: number | null) => {
  if (goal === null) localStorage.removeItem(FASTING_KEY);
  else localStorage.setItem(FASTING_KEY, String(goal));
  listeners.forEach((l) => l());
};
const useGoal = () =>
  useSyncExternalStore(
    subscribe,
    () => readGoal(localStorage.getItem(FASTING_KEY)),
    () => null,
  );

type Meals = { at: number }[];

// Today's meals miss last night's dinner; the most recent meal fills it in.
function useLastMeal(meals: Meals, now: number) {
  const recent = useQuery(api.meals.recent, { limit: 1 });
  return lastMealAt([...meals, ...(recent ?? [])], now);
}

function when(at: number, now: number) {
  const { startMs, endMs } = localDayRange(new Date(now));
  const day =
    at >= endMs
      ? "tomorrow "
      : at >= startMs
        ? ""
        : at >= localDayRange(new Date(startMs - 1)).startMs
          ? "yesterday "
          : `${new Date(at).toLocaleDateString([], { weekday: "long" })} `;
  return `${day}at ${timeLabel(at)}`;
}

// A line on the meals card that offers the timer while it's off.
export function FastingPrompt({ meals, now }: { meals: Meals; now: number }) {
  const goal = useGoal();
  const last = useLastMeal(meals, now);
  if (goal !== null || last === null) return null;
  return (
    <div className="row spaced fast-prompt">
      <span className="muted small">Last ate {duration(now - last)} ago</span>
      <button type="button" className="soft-button" onClick={() => setGoal(16)}>
        <Hourglass size={16} /> Fasting timer
      </button>
    </div>
  );
}

// Keyed by goal, so picking a goal already passed doesn't celebrate.
function Celebrate({ reached }: { reached: boolean }) {
  return <Burst count={useCrossing(reached)} />;
}

const SIZE = 112,
  STROKE = 10,
  R = SIZE / 2 - STROKE / 2,
  C = 2 * Math.PI * R;

// Time since the last logged meal against a chosen fasting goal. The next
// meal logged ends the fast and starts the clock again.
export function FastingCard({ meals, now }: { meals: Meals; now: number }) {
  const goal = useGoal();
  const last = useLastMeal(meals, now);
  const state =
    last === null || goal === null ? null : fastState(last, now, goal);
  if (goal === null || last === null || !state) return null;
  return (
    <section
      className={`card fasting-card${state.reached ? " reached" : ""}`}
      aria-labelledby="fast-title"
    >
      <Celebrate key={goal} reached={state.reached} />
      <SectionTitle
        id="fast-title"
        title="Fasting"
        detail={`Since your last meal ${when(last, now)}`}
        action={
          <span className="icon-tile green">
            <Hourglass size={22} />
          </span>
        }
      />
      <div className="fast-body">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${Math.round(state.progress * 100)}% of a ${goal} hour fast`}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              className="ring-track"
              strokeWidth={STROKE}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              className="fast-arc"
              strokeWidth={STROKE}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - state.progress)}
              opacity={state.progress > 0 ? 1 : 0}
            />
          </g>
        </svg>
        <div className="fast-readout">
          <strong>{duration(state.elapsed)}</strong>
          <span className="muted small">
            {state.reached
              ? `${goal} h goal reached ${when(state.goalAt, now)}`
              : `${duration(state.left)} to your ${goal} h goal, ${when(state.goalAt, now)}`}
          </span>
        </div>
      </div>
      <div className="fast-goals" role="group" aria-label="Fasting goal">
        {FASTING_GOALS.map((g) => (
          <button
            key={g}
            type="button"
            className="chip"
            aria-pressed={g === goal}
            aria-label={`${g} hours`}
            onClick={() => setGoal(g)}
          >
            {g} h
          </button>
        ))}
      </div>
      <div className="row spaced">
        <span className="muted small">Your next logged meal ends it.</span>
        <button
          type="button"
          className="text-button"
          onClick={() => setGoal(null)}
        >
          Hide timer
        </button>
      </div>
    </section>
  );
}
