"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Footprints, Plus, Target } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DEFAULT_STEP_GOAL, STREAK_CAP } from "@/lib/steps";
import { dayKey } from "@/lib/insights";
import { deviceTimeZone } from "./coach";
import { settledNow, useLatest } from "./review";
import { Progress, SectionTitle, Sheet, timeLabel, useTask } from "./ui";

type Week = FunctionReturnType<typeof api.steps.week>;
type Editing = { day: string; count: number | null } | "goal" | null;

const MAX_STEPS = 100_000;

export const steps = (n: number) => Math.round(n).toLocaleString("en-US");
// "9.1k" fits under a 34 px bar at 320 px; the label carries the exact count.
const compact = (n: number) =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(Math.floor(n / 100) / 10).toLocaleString("en-US")}k`
      : String(Math.round(n));

const date = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const weekday = (day: string, style: "narrow" | "long") =>
  date(day).toLocaleDateString("en-US", { weekday: style });
const shortDay = (day: string) =>
  date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function todayLine({ today, goal }: Pick<Week, "today" | "goal">) {
  if (today.count === null) return "No steps yet today.";
  if (today.count >= goal) return `${steps(today.count)} today. Goal reached.`;
  return `${steps(today.count)} of ${steps(goal)} today, ${steps(goal - today.count)} to go.`;
}

export function syncLine(lastSync: number | null, now: number) {
  if (lastSync === null) return null;
  const minutes = Math.floor((now - lastSync) / 60_000);
  if (minutes < 1) return "Synced from Apple Health just now.";
  if (minutes < 60) return `Synced from Apple Health ${minutes} min ago.`;
  if (dayKey(new Date(lastSync)) === dayKey(new Date(now)))
    return `Synced from Apple Health at ${timeLabel(lastSync)}.`;
  return `Last synced from Apple Health on ${shortDay(dayKey(new Date(lastSync)))}.`;
}

export function StepsCard({ now }: { now: number }) {
  const week = useLatest(
    useQuery(api.steps.week, {
      now: settledNow(now),
      timeZone: deviceTimeZone(),
    }),
  );
  const [editing, setEditing] = useState<Editing>(null);
  if (!week) return null;
  const today = week.today.day;
  const peak = Math.max(
    week.goal * 1.25,
    ...week.days.map((d) => d.count ?? 0),
  );
  const goalAt = (week.goal / peak) * 100;
  const sync = syncLine(week.lastSync, now);
  const empty =
    week.lastSync === null &&
    week.best === null &&
    week.days.every((d) => d.count === null);

  return (
    <section
      id="steps"
      className="card steps-card"
      aria-labelledby="steps-title"
    >
      <SectionTitle
        id="steps-title"
        title="Steps"
        detail={todayLine(week)}
        action={
          <span className="icon-tile green">
            <Footprints size={22} />
          </span>
        }
      />
      {week.today.count !== null && (
        <Progress
          value={week.today.count / week.goal}
          label={`Steps today, of ${steps(week.goal)}`}
        />
      )}
      <ol
        className="cardio-week steps-week"
        aria-label="Steps each day this week"
      >
        {week.days.map((d) => {
          const met = d.count !== null && d.count >= week.goal;
          const label = `${weekday(d.day, "long")}: ${
            d.count === null ? "no steps" : `${steps(d.count)} steps`
          }${met ? ", goal reached" : ""}`;
          const bar = (
            <>
              <span className="cardio-week-value" aria-hidden>
                {d.count === null ? "" : compact(d.count)}
              </span>
              <span className="cardio-week-track" aria-hidden>
                <span
                  className={`cardio-week-bar${met ? "" : " short"}`}
                  style={{
                    height: `${Math.min(100, ((d.count ?? 0) / peak) * 100)}%`,
                  }}
                />
                <span className="steps-goal" style={{ bottom: `${goalAt}%` }} />
              </span>
              <span className="cardio-week-day" aria-hidden>
                {weekday(d.day, "narrow")}
              </span>
            </>
          );
          return (
            <li key={d.day} className={d.day === today ? "today" : undefined}>
              {d.day > today ? (
                <span className="steps-day" role="img" aria-label={label}>
                  {bar}
                </span>
              ) : (
                <button
                  type="button"
                  className="steps-day"
                  aria-label={`${label}. Edit`}
                  onClick={() => setEditing({ day: d.day, count: d.count })}
                >
                  {bar}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {!empty && (
        <dl className="week-stats steps-stats">
          <div>
            <dt>This week</dt>
            <dd>{compact(week.weekTotal)}</dd>
          </div>
          <div>
            <dt>At goal</dt>
            <dd>
              {week.daysAtGoal}
              <small> of 7</small>
            </dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>
              {week.streak}
              {week.streak >= STREAK_CAP && "+"}
              <small> {week.streak === 1 ? "day" : "days"}</small>
            </dd>
          </div>
          <div>
            <dt>28-day avg</dt>
            <dd>{week.average28 === null ? "–" : compact(week.average28)}</dd>
          </div>
        </dl>
      )}
      <p className="muted small steps-note">
        {empty
          ? "Enter your steps, or send them from Apple Health with a Shortcut (Settings → Apple Shortcuts)."
          : [
              sync,
              week.best &&
                `Best ${steps(week.best.count)} on ${shortDay(week.best.day)}.`,
            ]
              .filter(Boolean)
              .join(" ")}
      </p>
      <div className="steps-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => setEditing({ day: today, count: week.today.count })}
        >
          <Plus size={18} aria-hidden /> Enter steps
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setEditing("goal")}
        >
          <Target size={17} aria-hidden /> Goal {steps(week.goal)}
        </button>
      </div>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === "goal"
            ? "Daily step goal"
            : editing && editing.day !== today
              ? `Steps on ${weekday(editing.day, "long")}`
              : "Steps today"
        }
      >
        {editing === "goal" ? (
          <GoalForm goal={week.goal} onDone={() => setEditing(null)} />
        ) : (
          editing && (
            <StepsForm
              key={editing.day}
              day={editing.day}
              count={editing.count}
              today={today}
              onDone={() => setEditing(null)}
            />
          )
        )}
      </Sheet>
    </section>
  );
}

function StepsForm({
  day: initialDay,
  count,
  today,
  onDone,
}: {
  day: string;
  count: number | null;
  today: string;
  onDone: () => void;
}) {
  const set = useMutation(api.steps.set);
  const remove = useMutation(api.steps.remove);
  const { run, pending } = useTask();
  const [day, setDay] = useState(initialDay);
  const [value, setValue] = useState(count === null ? "" : String(count));
  const [confirming, setConfirming] = useState(false);
  const t = date(today);
  const earliest = dayKey(
    new Date(t.getFullYear(), t.getMonth(), t.getDate() - 400),
  );
  const n = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(n) &&
    n >= 0 &&
    n <= MAX_STEPS &&
    day >= earliest &&
    day <= today;
  // Only the day the sheet opened on is known to have a count to remove.
  const removable = count !== null && day === initialDay;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!valid) return;
    const ok = await run(
      () => set({ day, count: n, timeZone: deviceTimeZone() }),
      `${steps(n)} steps saved`,
    );
    if (ok) onDone();
  };
  const del = async () => {
    if (!confirming) return setConfirming(true);
    if (await run(() => remove({ day }), "Steps removed")) onDone();
  };

  return (
    <form className="steps-form" onSubmit={submit}>
      <label>
        Steps
        <span className="unit-input">
          <input
            name="steps"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_STEPS}
            step={1}
            required
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span>steps</span>
        </span>
      </label>
      <label>
        Day
        <input
          name="day"
          type="date"
          min={earliest}
          max={today}
          required
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <p className="muted small">
        Apple Health counts steps from your phone and watch. A Shortcut can send
        them for you each evening.
      </p>
      <button className="primary-button" disabled={!valid || pending}>
        Save steps
      </button>
      {removable && (
        <button
          type="button"
          className="text-button danger"
          disabled={pending}
          onClick={() => void del()}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? "Tap again to remove" : "Remove this day"}
        </button>
      )}
    </form>
  );
}

function GoalForm({ goal, onDone }: { goal: number; onDone: () => void }) {
  const setGoal = useMutation(api.steps.setGoal);
  const { run, pending } = useTask();
  const [value, setValue] = useState(String(goal));
  const n = Number(value);
  const valid =
    value.trim() !== "" && Number.isInteger(n) && n >= 1000 && n <= 50_000;
  const save = async (next: number | null) => {
    const ok = await run(
      () => setGoal({ goal: next }),
      `Goal set to ${steps(next ?? DEFAULT_STEP_GOAL)} steps`,
    );
    if (ok) onDone();
  };
  return (
    <form
      className="steps-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save(n);
      }}
    >
      <label>
        Daily goal
        <span className="unit-input">
          <input
            name="goal"
            type="number"
            inputMode="numeric"
            min={1000}
            max={50_000}
            step={1}
            required
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span>steps</span>
        </span>
      </label>
      <p className="muted small">
        Between 1,000 and 50,000. Most people land between 6,000 and 10,000.
      </p>
      <button className="primary-button" disabled={!valid || pending}>
        Save goal
      </button>
      {goal !== DEFAULT_STEP_GOAL && (
        <button
          type="button"
          className="text-button"
          disabled={pending}
          onClick={() => void save(null)}
        >
          Use the default ({steps(DEFAULT_STEP_GOAL)})
        </button>
      )}
    </form>
  );
}
