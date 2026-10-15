"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Award,
  CalendarCheck,
  Check,
  Droplet,
  Droplets,
  Footprints,
  Dumbbell,
  HeartPulse,
  Layers,
  ListChecks,
  Medal,
  Mountain,
  PersonStanding,
  Play,
  TrendingUp,
  Trophy,
  Utensils,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { deviceTimeZone } from "./coach";
import { SectionTitle } from "./ui";
import { WeekStory } from "./week-story";

type Achievement = FunctionReturnType<typeof api.achievements.list>[number];

// The clock ticks every 15 s; rounding up to the next 5 minutes keeps the
// subscription stable while still including everything logged so far.
const STEP = 5 * 60_000;
const settledNow = (now: number) => Math.ceil(now / STEP) * STEP;

// Keeps the last result while new args load, so cards don't flash.
function useLatest<T>(value: T | undefined) {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
}

const whole = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const civil = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

export function WeeklyReview({ now }: { now: number }) {
  const review = useLatest(
    useQuery(api.coach.weeklyReview, {
      now: settledNow(now),
      timeZone: deviceTimeZone(),
    }),
  );
  const [playing, setPlaying] = useState(false);
  if (!review) return null;
  const water = Math.min(100, review.waterGoalPercent);
  const cardioPercent = Math.min(
    100,
    ((review.cardioActiveMinutes ?? 0) / (review.cardioGoal ?? 150)) * 100,
  );
  return (
    <section className="card weekly-review" aria-labelledby="week-title">
      <SectionTitle
        title="Your week"
        id="week-title"
        detail={`${civil(review.fromDay)} – ${civil(review.toDay)}`}
        action={
          <span className="icon-tile green">
            <CalendarCheck size={22} />
          </span>
        }
      />
      <div
        className="week-days"
        aria-label={`Logged ${review.daysLogged} of 7 days`}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} className={i < review.daysLogged ? "on" : undefined} />
        ))}
        <span className="small">
          <strong>{review.daysLogged}</strong> of 7 days logged
        </span>
      </div>
      <dl className="week-stats">
        <div>
          <dt>Workouts</dt>
          <dd>{review.workouts}</dd>
        </div>
        <div>
          <dt>Sets</dt>
          <dd>{whole(review.totalSets)}</dd>
        </div>
        <div>
          <dt>New PRs</dt>
          <dd>{review.newPRs}</dd>
        </div>
        <div>
          <dt>Avg sleep</dt>
          <dd>
            {review.avgSleepHours === null ? (
              "–"
            ) : (
              <>
                {review.avgSleepHours.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
                <small> h</small>
              </>
            )}
          </dd>
        </div>
      </dl>
      <div className="week-water">
        <div className="row spaced small">
          <span>
            <Droplets size={15} className="blue-text" aria-hidden /> Water{" "}
            {whole(review.avgWaterMl)} ml a day
          </span>
          <strong>{whole(review.waterGoalPercent)}% of goal</strong>
        </div>
        <div
          className="week-water-track"
          role="meter"
          aria-label="Average water against goal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(water)}
        >
          <span style={{ width: `${water}%` }} />
        </div>
      </div>
      {!!review.cardioSessions && (
        <div className="week-water week-cardio">
          <div className="row spaced small">
            <span>
              <Footprints size={15} aria-hidden /> Cardio{" "}
              {review.cardioSessions}{" "}
              {review.cardioSessions === 1 ? "session" : "sessions"}
            </span>
            <strong>
              {whole(review.cardioActiveMinutes ?? 0)} of {review.cardioGoal}{" "}
              active min
            </strong>
          </div>
          <div
            className="week-water-track"
            role="meter"
            aria-label="Active cardio minutes against the weekly goal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(cardioPercent)}
          >
            <span style={{ width: `${cardioPercent}%` }} />
          </div>
        </div>
      )}
      <button
        type="button"
        className="soft-button week-play"
        onClick={() => setPlaying(true)}
      >
        <Play size={16} aria-hidden /> Play your week
      </button>
      {playing && (
        <WeekStory
          review={review}
          now={now}
          onClose={() => setPlaying(false)}
        />
      )}
    </section>
  );
}

const BADGES: Record<string, { Icon: LucideIcon; tone: string }> = {
  "first-workout": { Icon: Dumbbell, tone: "green" },
  "workouts-10": { Icon: Medal, tone: "green" },
  "workouts-50": { Icon: Trophy, tone: "green" },
  "sets-100": { Icon: Layers, tone: "green" },
  "sets-1000": { Icon: Mountain, tone: "green" },
  "first-pr": { Icon: TrendingUp, tone: "green" },
  "water-streak-3": { Icon: Droplet, tone: "blue" },
  "water-streak-7": { Icon: Droplets, tone: "blue" },
  "water-streak-30": { Icon: Waves, tone: "blue" },
  "checkin-streak-7": { Icon: HeartPulse, tone: "amber" },
  "all-muscles-7": { Icon: PersonStanding, tone: "green" },
  "meals-10": { Icon: Utensils, tone: "amber" },
  "habit-streak-7": { Icon: ListChecks, tone: "green" },
  "habit-streak-30": { Icon: CalendarCheck, tone: "green" },
};

const R = 25;
const C = 2 * Math.PI * R;

function Badge({
  a,
  selected,
  onSelect,
}: {
  a: Achievement;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon, tone } = BADGES[a.id] ?? { Icon: Award, tone: "green" };
  const earned = a.earnedAt !== null;
  const share = a.progress.target ? a.progress.value / a.progress.target : 0;
  return (
    <button
      type="button"
      className={`badge ${tone} ${earned ? "earned" : ""}`}
      aria-pressed={selected}
      aria-label={`${a.title}, ${earned ? "earned" : `${a.progress.value} of ${a.progress.target}`}`}
      onClick={onSelect}
    >
      <span className="badge-medal">
        <svg className="badge-ring" viewBox="0 0 56 56" aria-hidden>
          <circle className="badge-track" cx="28" cy="28" r={R} />
          {!earned && share > 0 && (
            <circle
              className="badge-arc"
              cx="28"
              cy="28"
              r={R}
              strokeDasharray={`${share * C} ${C}`}
              transform="rotate(-90 28 28)"
            />
          )}
        </svg>
        <Icon className="badge-icon" size={22} strokeWidth={1.75} />
        {earned && (
          <span className="badge-check">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="badge-title">{a.title}</span>
    </button>
  );
}

export function Achievements({ now }: { now: number }) {
  const list = useLatest(
    useQuery(api.achievements.list, {
      now: settledNow(now),
      timeZone: deviceTimeZone(),
    }),
  );
  const [picked, setPicked] = useState<string | null>(null);
  if (!list) return null;
  const earned = list.filter((a) => a.earnedAt !== null);
  // Default to the closest unearned badge: it's the next thing to chase.
  const next = list
    .filter((a) => a.earnedAt === null && a.progress.target > 0)
    .sort(
      (x, y) =>
        y.progress.value / y.progress.target -
        x.progress.value / x.progress.target,
    )[0];
  const shown = list.find((a) => a.id === picked) ?? next ?? earned.at(-1);
  return (
    <section className="card achievements" aria-labelledby="badges-title">
      <SectionTitle
        title="Achievements"
        id="badges-title"
        detail={`${earned.length} of ${list.length} earned`}
        action={
          <span className="icon-tile amber">
            <Trophy size={22} />
          </span>
        }
      />
      <div className="badge-grid">
        {list.map((a) => (
          <Badge
            key={a.id}
            a={a}
            selected={shown?.id === a.id}
            onSelect={() => setPicked(a.id)}
          />
        ))}
      </div>
      {shown && (
        <div className="badge-detail" aria-live="polite">
          <strong>{shown.title}</strong>
          <p className="small muted">{shown.detail}</p>
          <p className="small">
            {shown.earnedAt !== null
              ? `Earned ${new Date(shown.earnedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
              : shown.progress.target === 0
                ? "Add muscles to your library to unlock this."
                : `${whole(shown.progress.value)} of ${whole(shown.progress.target)} so far`}
          </p>
        </div>
      )}
    </section>
  );
}
