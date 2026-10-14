"use client";
import { useMutation, useQuery } from "convex/react";
import { Coffee, Plus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  CAFFEINE_PRESETS,
  DAILY_LIMIT_MG,
  SLEEP_READY_MG,
  caffeineAt,
  caffeineCurve,
  dayTotal,
  peakAfter,
  sleepReadyAt,
} from "@/lib/caffeine";
import { localDayRange } from "@/lib/day";
import { Progress, SectionTitle, timeLabel, useClock, useTask } from "./ui";

const W = 320;
const H = 140;
const PAD = { top: 16, right: 12, bottom: 22, left: 34 };
const HOUR = 3_600_000;
const STEP_MIN = 10;

const mg = (n: number) => `${Math.round(n).toLocaleString()} mg`;

// Caffeine still in the body from 6 hours back to 18 ahead, from a 45-minute
// absorption and 5-hour half-life, with when it falls to a sleep-friendly level.
export function CaffeineCard() {
  const now = useClock();
  const { startMs: dayStart, endMs: dayEnd } = localDayRange(new Date(now));
  // Yesterday evening's coffee still counts this morning.
  const doses = useQuery(api.caffeine.list, {
    startMs: dayStart - 12 * HOUR,
    endMs: dayEnd,
  });
  const add = useMutation(api.caffeine.add),
    remove = useMutation(api.caffeine.remove);
  const { run, pending } = useTask();
  const [custom, setCustom] = useState(false);
  if (!doses) return null;

  const log = (dose: { mg: number; label: string; at?: number }) =>
    run(
      () => add({ mg: dose.mg, label: dose.label, at: dose.at ?? Date.now() }),
      `Logged ${dose.label} · ${mg(dose.mg)}`,
      (id) => remove({ id }),
    );
  const today = doses.filter((d) => d.at >= dayStart);
  const total = dayTotal(doses, dayStart, dayEnd);
  const level = caffeineAt(doses, now);
  const sleepAt = sleepReadyAt(doses, now);
  const peak = peakAfter(doses, now);
  const rising = peak.t > now && peak.mg - level >= 1;
  const summary = !doses.length
    ? "Nothing logged today."
    : [
        `${mg(level)} in you now`,
        rising ? `peaks at ${mg(peak.mg)} around ${timeLabel(peak.t)}` : "",
        sleepAt === now
          ? "sleep-ready"
          : sleepAt === null
            ? "not sleep-ready within two days"
            : `sleep-ready by ${timeLabel(sleepAt)}`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <section className="card caffeine-card" aria-labelledby="caffeine-title">
      <SectionTitle
        id="caffeine-title"
        title="Caffeine"
        detail={summary}
        action={
          <span className="icon-tile amber">
            <Coffee size={22} />
          </span>
        }
      />
      {doses.length > 0 && (
        <CaffeineCurve doses={doses} now={now} sleepAt={sleepAt} />
      )}
      <div className="caffeine-total">
        <Progress
          value={total / DAILY_LIMIT_MG}
          label={`Caffeine today, of ${DAILY_LIMIT_MG} mg`}
          tone="amber"
        />
        <p className="small muted">
          {mg(total)} of {DAILY_LIMIT_MG} mg today
        </p>
      </div>
      {total > DAILY_LIMIT_MG && (
        <p className="caffeine-over small" role="note">
          <TriangleAlert size={16} aria-hidden />
          Over the {DAILY_LIMIT_MG} mg a day the FDA considers safe for most
          adults.
        </p>
      )}
      <div
        className="chip-row caffeine-presets"
        role="group"
        aria-label="Log caffeine"
      >
        {CAFFEINE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            disabled={pending}
            title={p.serving}
            aria-label={`Log ${p.name}, ${p.mg} mg`}
            onClick={() => void log({ mg: p.mg, label: p.name })}
          >
            {p.name}
            <span className="muted">{p.mg}</span>
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-expanded={custom}
          aria-controls="caffeine-custom"
          onClick={() => setCustom((c) => !c)}
        >
          <Plus size={16} aria-hidden /> Other
        </button>
      </div>
      {custom && (
        <form
          id="caffeine-custom"
          className="caffeine-custom"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            if (
              await log({
                mg: Number(data.get("mg")),
                label: String(data.get("label")).trim() || "Caffeine",
              })
            )
              setCustom(false);
          }}
        >
          <div>
            <label htmlFor="caffeine-label" className="small muted">
              Drink
            </label>
            <input
              id="caffeine-label"
              name="label"
              maxLength={40}
              placeholder="Matcha latte"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="caffeine-mg" className="small muted">
              Amount
            </label>
            <span className="unit-input">
              <input
                id="caffeine-mg"
                name="mg"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                required
                placeholder="70"
              />
              <span>mg</span>
            </span>
          </div>
          <button className="primary-button" disabled={pending}>
            Log
          </button>
        </form>
      )}
      {today.length > 0 && (
        <ul className="entry-list caffeine-list" aria-label="Caffeine today">
          {[...today].reverse().map((d) => (
            <DoseRow
              key={d._id}
              dose={d}
              disabled={pending}
              onDelete={() =>
                run(
                  () => remove({ id: d._id }),
                  `Removed ${d.label}`,
                  () => add({ mg: d.mg, label: d.label, at: d.at }),
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DoseRow({
  dose,
  disabled,
  onDelete,
}: {
  dose: Doc<"caffeine">;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <li>
      <div>
        <strong>{dose.label}</strong>
        <span className="small muted">
          {timeLabel(dose.at)} · {mg(dose.mg)}
        </span>
      </div>
      <button
        type="button"
        className="icon-button"
        disabled={disabled}
        aria-label={`Remove ${dose.label} at ${timeLabel(dose.at)}`}
        onClick={onDelete}
      >
        <X size={18} />
      </button>
    </li>
  );
}

function CaffeineCurve({
  doses,
  now,
  sleepAt,
}: {
  doses: Doc<"caffeine">[];
  now: number;
  sleepAt: number | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  // Whole hours keep the curve still between clock ticks.
  const from = Math.floor(now / HOUR) * HOUR - 6 * HOUR;
  const to = from + 24 * HOUR;
  const points = caffeineCurve(doses, from, to, STEP_MIN);
  const highest = Math.max(...points.map((p) => p.mg));
  const top = Math.max(150, Math.ceil((highest * 1.15) / 50) * 50);
  const x = (t: number) =>
    PAD.left + ((t - from) / (to - from)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.mg).toFixed(1)}`)
    .join("");
  const area = `${line}L${x(to)},${y(0)}L${x(from)},${y(0)}Z`;
  const shown = active === null ? null : points[active];
  const nowIndex = Math.round((now - from) / (STEP_MIN * 60_000));
  const sleepShown = sleepAt !== null && sleepAt > now && sleepAt <= to;
  const ticks = [0, 6, 12, 18, 24].map((h) => from + h * HOUR);

  const pick = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(ratio * (points.length - 1));
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  };

  return (
    <figure className="caffeine-chart">
      <figcaption className="chart-readout" aria-live="polite">
        {shown
          ? `${shown.t === now ? "Now" : timeLabel(shown.t)} · ${mg(shown.mg)}`
          : `Now · ${mg(caffeineAt(doses, now))}`}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Caffeine in your body from ${timeLabel(from)} to ${timeLabel(to)}. ${
          sleepShown
            ? `Falls to ${SLEEP_READY_MG} mg at ${timeLabel(sleepAt)}.`
            : ""
        } Use arrow keys to step through hours.`}
        onPointerMove={(e) =>
          pick(e.clientX, e.currentTarget.getBoundingClientRect())
        }
        onPointerDown={(e) =>
          pick(e.clientX, e.currentTarget.getBoundingClientRect())
        }
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight" ? 6 : e.key === "ArrowLeft" ? -6 : 0;
          if (!step) return;
          e.preventDefault();
          setActive((i) =>
            Math.min(
              points.length - 1,
              Math.max(0, (i ?? Math.min(nowIndex, points.length - 1)) + step),
            ),
          );
        }}
      >
        <g className="chart-gridline">
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
          <text x={PAD.left - 6} y={y(0)} dy="0.32em" textAnchor="end">
            0
          </text>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(top)} y2={y(top)} />
          <text x={PAD.left - 6} y={y(top)} dy="0.32em" textAnchor="end">
            {top}
          </text>
        </g>
        <g className="caffeine-threshold">
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(SLEEP_READY_MG)}
            y2={y(SLEEP_READY_MG)}
          />
          <text
            x={PAD.left - 6}
            y={y(SLEEP_READY_MG)}
            dy="0.32em"
            textAnchor="end"
          >
            {SLEEP_READY_MG}
          </text>
        </g>
        {ticks.map((t, i) => (
          <text
            key={t}
            className="chart-axis-label"
            x={x(t)}
            y={H - 6}
            textAnchor={
              i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"
            }
          >
            {new Date(t).toLocaleTimeString([], { hour: "numeric" })}
          </text>
        ))}
        <path d={area} className="caffeine-area" />
        <path d={line} className="caffeine-line" />
        {doses
          .filter((d) => d.at >= from && d.at <= to)
          .map((d) => (
            <line
              key={d._id}
              className="caffeine-dose"
              x1={x(d.at)}
              x2={x(d.at)}
              y1={y(0)}
              y2={y(0) - 6}
            />
          ))}
        <g className="caffeine-now">
          <line x1={x(now)} x2={x(now)} y1={PAD.top - 6} y2={y(0)} />
          <text x={x(now)} y={PAD.top - 8} textAnchor="middle">
            now
          </text>
        </g>
        {sleepShown && (
          <g className="caffeine-sleep">
            <circle cx={x(sleepAt)} cy={y(SLEEP_READY_MG)} r={4} />
            <text
              x={x(sleepAt)}
              // Below the line: the curve is above it until this point.
              y={y(SLEEP_READY_MG) + 16}
              textAnchor={x(sleepAt) > W - 60 ? "end" : "middle"}
            >
              sleep-ready {timeLabel(sleepAt)}
            </text>
          </g>
        )}
        {shown && (
          <g className="caffeine-cursor">
            <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={y(0)} />
            <circle cx={x(shown.t)} cy={y(shown.mg)} r={5} />
          </g>
        )}
      </svg>
    </figure>
  );
}
