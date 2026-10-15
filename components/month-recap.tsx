"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CalendarCheck,
  CalendarRange,
  Droplets,
  Dumbbell,
  Footprints,
  ListChecks,
  Moon,
  Play,
  Scale,
  Sparkles,
  Star,
  Target,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { CardioKind } from "@/lib/cardio";
import { dayKey } from "@/lib/insights";
import { minutesLabel } from "./cardio";
import { deviceTimeZone } from "./coach";
import { settledNow, useLatest } from "./review";
import { SectionTitle } from "./ui";
import { StoryPlayer, type Slide } from "./week-story";

type Recap = FunctionReturnType<typeof api.recap.month>;

const whole = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const oneDp = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const plural = (n: number, noun: string) =>
  `${whole(n)} ${noun}${n === 1 ? "" : "s"}`;
const percentBar = (share: number) => (
  <span className="story-bar" aria-hidden>
    <span style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
  </span>
);

const ACTIVITY: Partial<Record<CardioKind, string>> = {
  run: "running",
  walk: "walking",
  ride: "riding",
  swim: "swimming",
  row: "rowing",
};
const BEST: Record<NonNullable<Recap["best"]>["reason"], string> = {
  "workout+cardio": "You lifted and got your cardio in.",
  workout: "Your biggest training day.",
  cardio: "You got your cardio in.",
};

function monthDate(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}
const monthName = (month: string) =>
  monthDate(month).toLocaleDateString([], { month: "long" });
function shiftMonth(month: string, by: number) {
  const d = monthDate(month);
  d.setMonth(d.getMonth() + by);
  return dayKey(d).slice(0, 7);
}
// The month's full length, so a month still underway reads "so far".
function daysIn(month: string) {
  const d = monthDate(month);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
const capitalize = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);
const signedKg = (kg: number) =>
  kg === 0 ? "±0 kg" : `${kg > 0 ? "+" : "−"}${oneDp(Math.abs(kg))} kg`;

export function recapSlides(recap: Recap): Slide[] {
  const name = monthName(recap.month);
  const previous = monthName(shiftMonth(recap.month, -1));
  const soFar = recap.days < daysIn(recap.month);
  const title = soFar
    ? `${name} so far`
    : `${name} ${monthDate(recap.month).getFullYear()}`;
  const slides: Slide[] = [
    {
      key: "days",
      icon: CalendarCheck,
      eyebrow: title,
      big: `${recap.daysLogged} of ${recap.days} days`,
      text:
        recap.daysLogged === recap.days
          ? "You logged something every single day."
          : `You logged something on ${plural(recap.daysLogged, "day")}.`,
      extra: percentBar(recap.daysLogged / recap.days),
    },
  ];

  if (recap.workouts) {
    const diff = recap.workouts - recap.previous.workouts;
    // A month still underway is only compared once it has pulled ahead.
    const versus =
      !recap.previous.workouts || (soFar && diff <= 0)
        ? ""
        : diff > 0
          ? ` ${diff} more than ${previous}${soFar ? " already" : ""}.`
          : diff < 0
            ? ` ${-diff} fewer than ${previous}.`
            : ` Same as ${previous}.`;
    const sets = plural(recap.totalSets, "set");
    const lifted = !recap.totalSets
      ? ""
      : recap.volumeKg
        ? `${sets} and ${whole(recap.volumeKg)} kg lifted.`
        : `${sets} logged.`;
    slides.push({
      key: "training",
      icon: Dumbbell,
      eyebrow: "Training",
      big: plural(recap.workouts, "workout"),
      // Workouts can be logged by muscle group alone, without sets or load.
      text: `${lifted}${versus}`.trim() || "Logged by muscle group.",
      extra: recap.newPRs ? (
        <span className="story-note">
          {plural(recap.newPRs, "new personal record")}.
        </span>
      ) : undefined,
    });
  } else
    slides.push({
      key: "training",
      icon: Dumbbell,
      eyebrow: "Training",
      big: "A month off lifting",
      text: "No workouts logged this month.",
    });

  if (recap.topMuscles.length)
    slides.push({
      key: "muscles",
      icon: Target,
      eyebrow: "Most trained",
      big: capitalize(recap.topMuscles[0].name),
      text: `${recap.topMuscles.map((m) => `${capitalize(m.name)} ${plural(m.workouts, "workout")}`).join(", ")}.`,
    });

  const { cardio } = recap;
  if (cardio.sessions) {
    const mostly = cardio.topKind && ACTIVITY[cardio.topKind];
    slides.push({
      key: "cardio",
      icon: Footprints,
      eyebrow: "Cardio",
      big: `${whole(cardio.activeMinutes)} active minutes`,
      text: `${plural(cardio.sessions, "session")}, ${minutesLabel(cardio.minutes)} in all${cardio.distanceKm > 0 ? `, ${oneDp(cardio.distanceKm)} km covered` : ""}.${mostly ? ` Mostly ${mostly}.` : ""}`,
    });
  }

  if (recap.weight)
    slides.push({
      key: "weight",
      icon: Scale,
      eyebrow: "Weight trend",
      big: signedKg(recap.weight.changeKg),
      text: `From ${oneDp(recap.weight.startKg)} to ${oneDp(recap.weight.endKg)} kg on your smoothed trend.`,
    });

  if (recap.habits && recap.habits.possible > 0)
    slides.push({
      key: "habits",
      icon: ListChecks,
      eyebrow: "Habits",
      big: `${Math.round((recap.habits.done / recap.habits.possible) * 100)}% done`,
      text: `${recap.habits.done} of ${recap.habits.possible} habit check-ins.`,
      extra: percentBar(recap.habits.done / recap.habits.possible),
    });

  slides.push({
    key: "water",
    icon: Droplets,
    eyebrow: "Water",
    big: `${whole(recap.water.avgMl)} ml a day`,
    text: recap.water.daysAtGoal
      ? `You reached your ${whole(recap.water.goalMl)} ml goal on ${plural(recap.water.daysAtGoal, "day")}.`
      : `You didn't reach your ${whole(recap.water.goalMl)} ml goal ${soFar ? "yet" : "this month"}.`,
    extra: percentBar(recap.water.avgMl / recap.water.goalMl),
  });

  if (recap.sleep.avgHours !== null)
    slides.push({
      key: "sleep",
      icon: Moon,
      eyebrow: "Sleep",
      big: `${oneDp(recap.sleep.avgHours)} h a night`,
      text: `Averaged over ${plural(recap.sleep.days, "logged night")}.`,
    });

  if (recap.best)
    slides.push({
      key: "best",
      icon: Star,
      eyebrow: "Standout day",
      big: new Date(`${recap.best.day}T12:00:00`).toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      text: BEST[recap.best.reason],
    });

  slides.push({
    key: "end",
    icon: Sparkles,
    eyebrow: `That's ${name}${soFar ? " so far" : ""}`,
    big:
      recap.previous.daysLogged > 0 &&
      recap.daysLogged > recap.previous.daysLogged
        ? `More days than ${previous}.`
        : "Every log counts.",
    text: soFar
      ? "The rest of the month is still yours to write."
      : "Keep logging and next month's story writes itself.",
  });
  return slides;
}

export function MonthRecap({ now }: { now: number }) {
  const thisMonth = dayKey(new Date(now)).slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  // A week in, this month has enough to tell; before that, last month does.
  const [picked, setPicked] = useState<"this" | "last">(() =>
    new Date(now).getDate() >= 7 ? "this" : "last",
  );
  const month = picked === "this" ? thisMonth : lastMonth;
  const recap = useLatest(
    useQuery(api.recap.month, {
      month,
      now: settledNow(now),
      timeZone: deviceTimeZone(),
    }),
  );
  const [playing, setPlaying] = useState(false);
  if (!recap) return null;
  const name = monthName(recap.month);
  const civil = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  return (
    <section className="card month-recap" aria-labelledby="month-title">
      <SectionTitle
        title="Your month"
        id="month-title"
        detail={`${civil(recap.fromDay)} – ${civil(recap.toDay)}`}
        action={
          <span className="icon-tile green">
            <CalendarRange size={22} />
          </span>
        }
      />
      <div className="segmented" role="group" aria-label="Month">
        {(
          [
            ["this", thisMonth],
            ["last", lastMonth],
          ] as const
        ).map(([id, m]) => (
          <button
            key={id}
            type="button"
            aria-pressed={picked === id}
            onClick={() => setPicked(id)}
          >
            {monthName(m)}
          </button>
        ))}
      </div>
      <dl className="week-stats">
        <div>
          <dt>Days</dt>
          <dd>
            {recap.daysLogged}
            <small>/{recap.days}</small>
          </dd>
        </div>
        <div>
          <dt>Workouts</dt>
          <dd>{recap.workouts}</dd>
        </div>
        <div>
          <dt>Active min</dt>
          <dd>{whole(recap.cardio.activeMinutes)}</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd>
            {recap.weight ? (
              <>
                {signedKg(recap.weight.changeKg).replace(" kg", "")}
                <small> kg</small>
              </>
            ) : (
              "–"
            )}
          </dd>
        </div>
      </dl>
      {recap.daysLogged > 0 && (
        <button
          type="button"
          className="soft-button week-play"
          onClick={() => setPlaying(true)}
        >
          <Play size={16} aria-hidden /> Play {name}
        </button>
      )}
      {playing && (
        <StoryPlayer
          label={recapSlides(recap)[0].eyebrow}
          slides={recapSlides(recap)}
          onClose={() => setPlaying(false)}
        />
      )}
    </section>
  );
}
