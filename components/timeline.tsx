"use client";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Droplets, Dumbbell, Footprints, Utensils } from "lucide-react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatPace, pace } from "@/lib/cardio";
import { localDayRange } from "@/lib/day";
import { dayKey } from "@/lib/insights";
import { mealTotals } from "@/lib/nutrients";
import { dayTimeline, type TimelineEvent } from "@/lib/timeline";
import { EFFORT_NAMES, sessionLine } from "./cardio";
import { SectionTitle, timeLabel } from "./ui";

type Meal = FunctionReturnType<typeof api.meals.today>[number];

const ICON = {
  water: Droplets,
  meal: Utensils,
  workout: Dumbbell,
  cardio: Footprints,
};

function describe(e: TimelineEvent) {
  if (e.kind === "water")
    return {
      title: `${e.ml.toLocaleString()} ml of water`,
      detail: e.drinks > 1 ? `${e.drinks} drinks` : null,
    };
  if (e.kind === "meal")
    return {
      title: e.title,
      detail:
        e.kcal === null
          ? "Analysing"
          : `${Math.round(e.kcal).toLocaleString()} kcal`,
    };
  if (e.kind === "cardio") {
    const p = pace(e.activity, e.distanceKm, e.minutes);
    return {
      title: sessionLine({ ...e, kind: e.activity }),
      detail: [EFFORT_NAMES[e.effort], p && formatPace(p)]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    title: e.muscles.length ? `Trained ${e.muscles.join(", ")}` : "Workout",
    detail: e.note || null,
  };
}

export function DayTimeline({
  now,
  water,
  meals,
  muscles,
}: {
  now: number;
  water: Doc<"water">[];
  meals: Meal[];
  muscles: { _id: Id<"muscles">; name: string }[];
}) {
  const { startMs } = localDayRange(new Date(now));
  // Newest first: keep paging until the history reaches before today.
  const { results, status, loadMore } = usePaginatedQuery(
    api.tracker.workoutHistory,
    {},
    { initialNumItems: 8 },
  );
  const pastToday = (results.at(-1)?.trainedAt ?? Infinity) < startMs;
  useEffect(() => {
    if (status === "CanLoadMore" && !pastToday) loadMore(8);
  }, [status, pastToday, loadMore]);
  const today = dayKey(new Date(now));
  const week = useQuery(api.cardio.week, { today });
  const names = new Map(muscles.map((m) => [m._id, m.name]));
  const events = dayTimeline({
    water,
    meals: meals.map((m) => ({
      id: m._id,
      at: m.at,
      title: m.description || "Meal",
      kcal: m.analysis.status === "ready" ? mealTotals(m.items).kcal : null,
    })),
    workouts: results
      .filter((w) => w.trainedAt >= startMs && w.trainedAt <= now)
      .map((w) => ({
        id: w._id,
        at: w.trainedAt,
        muscles: w.muscleIds.flatMap((id) => names.get(id) ?? []),
        note: w.note,
      })),
    cardio: (week?.sessions ?? [])
      .filter((s) => s.day === today)
      .map((s) => ({
        id: s.id,
        // A session logged ahead of time for today sits at the start of the day.
        at: Math.min(Math.max(s.createdAt, startMs), now),
        activity: s.kind,
        effort: s.effort,
        minutes: s.minutes,
        distanceKm: s.distanceKm,
      })),
  });
  if (!events.length) return null;
  return (
    <section className="card day-timeline" aria-labelledby="timeline-title">
      <SectionTitle
        title="Your day"
        id="timeline-title"
        detail={`${events.length} ${events.length === 1 ? "moment" : "moments"}`}
      />
      <ol>
        {events.map((e) => {
          const Icon = ICON[e.kind];
          const { title, detail } = describe(e);
          return (
            <li
              key={e.kind === "water" ? `water:${e.at}` : e.id}
              className={e.kind}
            >
              <time dateTime={new Date(e.at).toISOString()}>
                {timeLabel(e.at)}
              </time>
              <span className="timeline-dot" aria-hidden>
                <Icon size={14} />
              </span>
              <span className="timeline-text">
                <strong>{title}</strong>
                {detail && <span className="muted small">{detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
