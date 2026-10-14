"use client";
import { useQuery } from "convex/react";
import {
  ChartColumnBig,
  CircleCheck,
  CircleDashed,
  Hourglass,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { VOLUME_HIGH, VOLUME_LOW, type WeeklyVolume } from "@/lib/volume";
import { SectionTitle } from "./ui";

// The Train card, muscle cards and muscle sheet share one subscription.
export const VOLUME_WEEKS = 8;
export const useWeeklyVolume = () =>
  useQuery(api.volume.weekly, { weeks: VOLUME_WEEKS });

type Row = WeeklyVolume["muscles"][number];

const STATUS: Record<Row["status"], { icon: LucideIcon; tone: string }> = {
  none: { icon: CircleDashed, tone: "none" },
  low: { icon: Hourglass, tone: "low" },
  "on-track": { icon: CircleCheck, tone: "on-track" },
  high: { icon: TriangleAlert, tone: "high" },
};

export function statusLabel(row: Row) {
  switch (row.status) {
    case "none":
      return "None since Monday";
    case "low":
      return `Behind pace for ${VOLUME_LOW}`;
    case "high":
      return `Above ${VOLUME_HIGH}`;
    default:
      return row.current >= VOLUME_LOW
        ? "In range"
        : `On pace for ${VOLUME_LOW}`;
  }
}

export function weekLabel(start: string) {
  return new Date(`${start}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

const sets = (n: number) => `${n} ${n === 1 ? "set" : "sets"}`;

// Working sets per muscle this week against the 10–20 range most people
// grow on. "Behind pace" is judged against how much of the week is left.
export function VolumeCard({ onOpen }: { onOpen?: (id: string) => void }) {
  const data = useWeeklyVolume();
  if (!data) return null;
  const active = data.muscles.filter((m) => m.current > 0 || m.average > 0);
  const idle = data.muscles.filter((m) => !active.includes(m));
  const inRange = active.filter(
    (m) => m.current >= VOLUME_LOW && m.current <= VOLUME_HIGH,
  ).length;
  const max = Math.max(
    VOLUME_HIGH + 4,
    ...active.flatMap((m) => [m.current, m.average]),
  );
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;

  return (
    <section className="card volume-card" aria-labelledby="volume-title">
      <SectionTitle
        id="volume-title"
        title="Weekly volume"
        detail={`Working sets since Monday, ${weekLabel(data.weeks.at(-1)!.start)}. ${VOLUME_LOW}–${VOLUME_HIGH} a week per muscle suits most goals.`}
        action={
          <span className="icon-tile green">
            <ChartColumnBig size={22} />
          </span>
        }
      />
      {active.length === 0 ? (
        <p className="small muted volume-empty">
          Log sets with an exercise to see your weekly volume.
        </p>
      ) : (
        <>
          <p className="small volume-summary">
            <strong>{inRange}</strong> of {active.length}{" "}
            {active.length === 1 ? "muscle" : "muscles"} in range this week
          </p>
          <p className="small muted volume-legend" aria-hidden>
            <span className="volume-key band" /> {VOLUME_LOW}–{VOLUME_HIGH}
            <span className="volume-key avg" /> Your {VOLUME_WEEKS - 1}-week
            average
          </p>
          <ul className="volume-list">
            {active.map((m) => {
              const { icon: Icon, tone } = STATUS[m.status];
              const average = Math.round(m.average);
              const body = (
                <>
                  <span className="volume-head">
                    <strong className="capitalize">{m.name}</strong>
                    <span>
                      <strong>{m.current}</strong>{" "}
                      {m.current === 1 ? "set" : "sets"}
                    </span>
                  </span>
                  <span className="volume-bar" aria-hidden>
                    <span
                      className="volume-band"
                      style={{
                        left: pct(VOLUME_LOW),
                        width: `calc(${pct(VOLUME_HIGH)} - ${pct(VOLUME_LOW)})`,
                      }}
                    />
                    {m.current > 0 && (
                      <span
                        className="volume-fill"
                        style={{ width: pct(m.current) }}
                      />
                    )}
                    {m.average > 0 && (
                      <span
                        className="volume-avg"
                        style={{ left: pct(m.average) }}
                      />
                    )}
                  </span>
                  <span className="volume-meta small">
                    <span className={`volume-status ${tone}`}>
                      <Icon size={14} aria-hidden />
                      {statusLabel(m)}
                    </span>
                    <span className="muted">
                      {m.average > 0
                        ? `Usually ${average < 1 ? "under 1" : sets(average)}`
                        : "New this week"}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={m.id} className={tone}>
                  {onOpen ? (
                    <button
                      type="button"
                      onClick={() => onOpen(m.id)}
                      aria-label={`${m.name}: ${sets(m.current)} this week, ${statusLabel(m).toLowerCase()}. Open details`}
                    >
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {idle.length > 0 && (
        <p className="small muted volume-idle">
          No sets in {VOLUME_WEEKS} weeks:{" "}
          <span className="capitalize">
            {idle.map((m) => m.name).join(", ")}
          </span>
        </p>
      )}
    </section>
  );
}
