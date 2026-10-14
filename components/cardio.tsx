"use client";
import { Fragment, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { HeartPulse, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  CARDIO_EFFORTS,
  CARDIO_KINDS,
  activeMinutes,
  formatPace,
  pace,
  type CardioEffort,
  type CardioKind,
} from "@/lib/cardio";
import { dayKey } from "@/lib/insights";
import { Progress, SectionTitle, Sheet, useClock, useTask } from "./ui";

type Week = NonNullable<FunctionReturnType<typeof api.cardio.week>>;
type Session = Week["sessions"][number];

export const KIND_NAMES: Record<CardioKind, string> = {
  run: "Run",
  walk: "Walk",
  ride: "Ride",
  swim: "Swim",
  row: "Row",
  other: "Other",
};
const EFFORT_NAMES: Record<CardioEffort, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
};
const EFFORT_HINTS: Record<CardioEffort, string> = {
  easy: "Easy: you could chat the whole way.",
  moderate: "Moderate: talking, but not singing.",
  hard: "Hard: a few words at a time. These minutes count double.",
};

const num = (n: number, dp = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: dp });
export const minutesLabel = (m: number) => {
  const total = Math.round(m);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  return total % 60 ? `${h} h ${total % 60} min` : `${h} h`;
};
const weekday = (day: string, style: "narrow" | "short" | "long") => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: style });
};
const shortDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

export function sessionLine(
  s: Pick<Session, "kind" | "minutes" | "distanceKm">,
) {
  return [
    KIND_NAMES[s.kind],
    s.distanceKm === null ? null : `${num(s.distanceKm, 2)} km`,
    minutesLabel(s.minutes),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function weekLine(
  week: Pick<
    Week,
    "activeMinutes" | "goal" | "streakWeeks" | "lastWeekActiveMinutes"
  >,
) {
  const left = Math.ceil(week.goal - week.activeMinutes);
  const head =
    left <= 0
      ? `Weekly goal reached: ${Math.round(week.activeMinutes)} active minutes.`
      : `${Math.floor(week.activeMinutes)} of ${week.goal} active minutes this week, ${left} to go.`;
  const tail =
    week.streakWeeks >= 2
      ? `${week.streakWeeks} weeks in a row.`
      : week.lastWeekActiveMinutes > 0
        ? `Last week ${Math.round(week.lastWeekActiveMinutes)}.`
        : "";
  return [head, tail].filter(Boolean).join(" ");
}

// Runs, rides and the rest, counted the way the WHO counts them: 150 active
// minutes a week, with hard minutes counting double.
export function CardioCard() {
  const now = useClock();
  const today = dayKey(new Date(now));
  const week = useQuery(api.cardio.week, { today });
  const bests = useQuery(api.cardio.bests, {});
  const [editing, setEditing] = useState<Session | "new" | null>(null);
  if (!week) return null;
  const peak = Math.max(30, ...week.days.map((d) => d.minutes));
  const bestBits = [
    bests?.longestRunKm != null &&
      `Longest run ${num(bests.longestRunKm, 2)} km`,
    bests?.fastestRun &&
      `fastest ${bests.fastestRun.pace} over ${num(bests.fastestRun.distanceKm, 2)} km on ${shortDay(bests.fastestRun.day)}`,
    bests?.longestRideKm != null &&
      `longest ride ${num(bests.longestRideKm, 2)} km`,
  ].filter(Boolean) as string[];

  return (
    <section className="card cardio-card" aria-labelledby="cardio-title">
      <SectionTitle
        id="cardio-title"
        title="Cardio"
        detail={weekLine(week)}
        action={
          <span className="icon-tile green">
            <HeartPulse size={22} />
          </span>
        }
      />
      <Progress
        value={week.activeMinutes / week.goal}
        label={`Active minutes this week, of ${week.goal}`}
      />
      <ol className="cardio-week" aria-label="Minutes each day this week">
        {week.days.map((d) => (
          <li
            key={d.day}
            className={d.day === today ? "today" : undefined}
            aria-label={`${weekday(d.day, "long")}: ${d.minutes ? minutesLabel(d.minutes) : "none"}`}
          >
            <span className="cardio-week-value" aria-hidden>
              {d.minutes ? Math.round(d.minutes) : ""}
            </span>
            <span className="cardio-week-track" aria-hidden>
              <span
                className="cardio-week-bar"
                style={{
                  height: `${Math.min(100, (d.minutes / peak) * 100)}%`,
                }}
              />
            </span>
            <span className="cardio-week-day" aria-hidden>
              {weekday(d.day, "narrow")}
            </span>
          </li>
        ))}
      </ol>
      {week.sessions.length > 0 && (
        <ul className="cardio-list" aria-label="This week's sessions">
          {week.sessions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setEditing(s)}>
                <span className="cardio-main">
                  <strong>
                    {sessionLine(s)
                      .split(" · ")
                      .map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 && " · "}
                          <span>{part}</span>
                        </Fragment>
                      ))}
                  </strong>
                  <span className="muted small">
                    {[
                      dayLabel(s.day, today),
                      EFFORT_NAMES[s.effort],
                      s.kcal === null ? null : `~${s.kcal} kcal`,
                      s.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {s.pace && <span className="cardio-pace">{s.pace}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {bestBits.length > 0 && (
        <p className="muted small cardio-bests">
          {bestBits.join(", ").replace(/^./, (c) => c.toUpperCase())}.
        </p>
      )}
      <button
        type="button"
        className="primary-button cardio-log"
        onClick={() => setEditing("new")}
      >
        <Plus size={18} aria-hidden /> Log cardio
      </button>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === "new" || editing === null ? "Log cardio" : "Edit session"
        }
      >
        {editing !== null && (
          <CardioForm
            key={editing === "new" ? "new" : editing.id}
            session={editing === "new" ? null : editing}
            today={today}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </section>
  );
}

function dayLabel(day: string, today: string) {
  if (day === today) return "Today";
  return weekday(day, "short");
}

export function CardioForm({
  session,
  today,
  onDone,
}: {
  session: Session | null;
  today: string;
  onDone: () => void;
}) {
  const add = useMutation(api.cardio.add);
  const update = useMutation(api.cardio.update);
  const remove = useMutation(api.cardio.remove);
  const { run, pending } = useTask();
  const [kind, setKind] = useState<CardioKind>(session?.kind ?? "run");
  const [effort, setEffort] = useState<CardioEffort>(
    session?.effort ?? "moderate",
  );
  const [minutes, setMinutes] = useState(
    session ? String(session.minutes) : "",
  );
  const [distance, setDistance] = useState(
    session?.distanceKm == null ? "" : String(session.distanceKm),
  );
  const [day, setDay] = useState(session?.day ?? today);
  const [confirming, setConfirming] = useState(false);

  const mins = Number(minutes);
  const km = distance.trim() === "" ? null : Number(distance);
  const validMinutes = minutes !== "" && mins >= 1 && mins <= 600;
  const validKm = km === null || (km > 0 && km <= 1000);
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today;
  const p = validMinutes && validKm ? pace(kind, km, mins) : null;
  const preview = [
    p && formatPace(p),
    validMinutes && `${Math.round(activeMinutes(mins, effort))} active min`,
  ]
    .filter(Boolean)
    .join(" · ");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "");
    const args = { kind, effort, day, minutes: mins, distanceKm: km, note };
    const ok = await run(
      () => (session ? update({ id: session.id, ...args }) : add(args)),
      session ? "Session updated" : `Logged ${KIND_NAMES[kind].toLowerCase()}`,
    );
    if (ok) onDone();
  };
  const del = async () => {
    if (!session) return;
    if (!confirming) return setConfirming(true);
    if (await run(() => remove({ id: session.id }), "Session deleted"))
      onDone();
  };

  return (
    <form className="cardio-form" onSubmit={submit}>
      <fieldset className="pick-grid">
        <legend>Activity</legend>
        {CARDIO_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {KIND_NAMES[k]}
          </button>
        ))}
      </fieldset>
      <div className="cardio-fields">
        <label>
          Duration
          <span className="unit-input">
            <input
              name="minutes"
              type="number"
              inputMode="decimal"
              min={1}
              max={600}
              step="any"
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <span>min</span>
          </span>
        </label>
        <label>
          Distance
          <span className="unit-input">
            <input
              name="distance"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={1000}
              step="any"
              placeholder="Optional"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
            <span>km</span>
          </span>
        </label>
      </div>
      <p className="cardio-preview muted small" aria-live="polite">
        {preview || "Add a duration to see pace and active minutes."}
      </p>
      <fieldset className="pick-grid three">
        <legend>Effort</legend>
        {CARDIO_EFFORTS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={effort === k}
            onClick={() => setEffort(k)}
          >
            {EFFORT_NAMES[k]}
          </button>
        ))}
      </fieldset>
      <p className="muted small cardio-hint">{EFFORT_HINTS[effort]}</p>
      <label className="cardio-day">
        Day
        <input
          name="day"
          type="date"
          max={today}
          required
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <label className="cardio-note">
        Note
        <input
          name="note"
          maxLength={200}
          placeholder="Optional, like “hill reps”"
          defaultValue={session?.note ?? ""}
        />
      </label>
      <button
        className="primary-button"
        disabled={pending || !validMinutes || !validKm || !validDay}
      >
        {pending ? "Saving…" : session ? "Save changes" : "Log session"}
      </button>
      {session && (
        <button
          type="button"
          className="text-button danger"
          disabled={pending}
          onClick={() => void del()}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? "Tap again to delete" : "Delete session"}
        </button>
      )}
    </form>
  );
}
