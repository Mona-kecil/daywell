"use client";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Annoyed,
  Frown,
  HeartPulse,
  Laugh,
  Meh,
  Smile,
  Zap,
} from "lucide-react";
import { useId, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { dayKey } from "@/lib/insights";
import { SectionTitle, useTask } from "./ui";

type CheckIn = NonNullable<FunctionReturnType<typeof api.checkins.get>>;
type Scale = "mood" | "energy";

export const MOODS = [
  { Icon: Frown, label: "Awful" },
  { Icon: Annoyed, label: "Low" },
  { Icon: Meh, label: "Okay" },
  { Icon: Smile, label: "Good" },
  { Icon: Laugh, label: "Great" },
];
export const ENERGY = ["Drained", "Tired", "Steady", "Lively", "Charged"];

export function CheckInCard({ now }: { now: number }) {
  const day = dayKey(new Date(now));
  const checkIn = useQuery(api.checkins.get, { day });
  if (checkIn === undefined) return null;
  // Remount the form when the day rolls over or another device saves.
  return (
    <CheckInForm
      key={`${day}:${checkIn?.weightKg}:${checkIn?.waistCm}:${checkIn?.sleepHours}:${checkIn?.note}`}
      day={day}
      checkIn={checkIn}
    />
  );
}

function CheckInForm({
  day,
  checkIn,
}: {
  day: string;
  checkIn: CheckIn | null;
}) {
  const upsert = useMutation(api.checkins.upsert);
  const { run, pending } = useTask();
  const id = useId();
  const number = (v: FormDataEntryValue | null) =>
    String(v ?? "").trim() ? Number(v) : null;

  const pick = (scale: Scale, value: number) =>
    run(
      () => upsert({ day, [scale]: checkIn?.[scale] === value ? null : value }),
      checkIn?.[scale] === value ? "Cleared" : undefined,
    );
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const note = String(data.get("note") ?? "").trim();
    void run(
      () =>
        upsert({
          day,
          sleepHours: number(data.get("sleep")),
          weightKg: number(data.get("weight")),
          waistCm: number(data.get("waist")),
          note: note || null,
        }),
      "Check-in saved",
    );
  };

  return (
    <section className="card checkin-card" aria-labelledby={`${id}-title`}>
      <SectionTitle
        title="How are you today?"
        id={`${id}-title`}
        action={
          <span className="icon-tile amber">
            <HeartPulse size={22} />
          </span>
        }
      />
      <div className="scale-row">
        <span className="scale-label" id={`${id}-mood`}>
          Mood
        </span>
        <div className="scale" role="group" aria-labelledby={`${id}-mood`}>
          {MOODS.map(({ Icon, label }, i) => (
            <button
              key={label}
              type="button"
              className="mood"
              aria-pressed={checkIn?.mood === i + 1}
              aria-label={label}
              title={label}
              disabled={pending}
              onClick={() => void pick("mood", i + 1)}
            >
              <Icon size={24} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </div>
      <div className="scale-row">
        <span className="scale-label" id={`${id}-energy`}>
          Energy
        </span>
        <div
          className="scale energy"
          role="group"
          aria-labelledby={`${id}-energy`}
        >
          {ENERGY.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={(checkIn?.energy ?? 0) > i}
              aria-label={`${i + 1} of 5, ${label}`}
              title={label}
              disabled={pending}
              onClick={() => void pick("energy", i + 1)}
            >
              <i style={{ height: `${8 + i * 6}px` }} />
            </button>
          ))}
          <Zap
            size={16}
            className={checkIn?.energy ? "amber-text" : "muted"}
            aria-hidden
          />
        </div>
      </div>
      <p className="muted small scale-caption" aria-live="polite">
        {checkIn?.mood || checkIn?.energy
          ? [
              checkIn.mood &&
                `Feeling ${MOODS[checkIn.mood - 1].label.toLowerCase()}`,
              checkIn.energy &&
                `${ENERGY[checkIn.energy - 1].toLowerCase()} energy`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Tap a face and a bar. Tap again to clear."}
      </p>
      <form className="checkin-fields" onSubmit={save}>
        <div className="target-grid">
          <label>
            Sleep
            <span className="unit-input">
              <input
                name="sleep"
                type="number"
                inputMode="decimal"
                min={0}
                max={24}
                step="any"
                placeholder="—"
                defaultValue={checkIn?.sleepHours ?? ""}
              />
              <span>h</span>
            </span>
          </label>
          <label>
            Weight
            <span className="unit-input">
              <input
                name="weight"
                type="number"
                inputMode="decimal"
                min={20}
                max={400}
                step="any"
                placeholder="—"
                defaultValue={checkIn?.weightKg ?? ""}
              />
              <span>kg</span>
            </span>
          </label>
          <label>
            Waist
            <span className="unit-input">
              <input
                name="waist"
                type="number"
                inputMode="decimal"
                min={40}
                max={200}
                step="any"
                placeholder="—"
                defaultValue={checkIn?.waistCm ?? ""}
              />
              <span>cm</span>
            </span>
          </label>
        </div>
        <label htmlFor={`${id}-note`}>
          Note <span className="muted">(optional)</span>
        </label>
        <input
          id={`${id}-note`}
          name="note"
          maxLength={280}
          placeholder="Sore knees, great nap, stressful day…"
          defaultValue={checkIn?.note ?? ""}
        />
        <button className="secondary-button full" disabled={pending}>
          Save check-in
        </button>
      </form>
    </section>
  );
}
