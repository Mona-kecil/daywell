"use client";
import { Pause, PersonStanding, Play, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  HOLDS,
  RECENT_MS,
  STRETCHES,
  stepAt,
  stepsMs,
  stretchSteps,
  type Hold,
  type StretchStep,
} from "@/lib/stretches";
import { muscleKey, type MuscleKey } from "./body3d/anatomy";
import { primeAudio, tone, useWakeLock } from "./session-kit";
import { SectionTitle } from "./ui";

const HOLD_KEY = "daywell.stretchHold";
const TICK_MS = 100;

type TrainedMuscle = { name: string; lastTrainedAt: number | null };

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const savedHold = (): Hold => {
  const n = Number(localStorage.getItem(HOLD_KEY));
  return (HOLDS as readonly number[]).includes(n) ? (n as Hold) : 30;
};
const sideLabel = (s: StretchStep) =>
  s.side === "left" ? "Left side" : s.side === "right" ? "Right side" : "";
const stepName = (s: StretchStep) =>
  s.side ? `${s.stretch.name}, ${s.side} side` : s.stretch.name;

export function announce(step: StretchStep | null) {
  if (!step) return "Done. Nice stretch.";
  if (step.kind === "hold") return "Hold";
  return `${stepName(step)}. ${step.stretch.cue}`;
}

// A cool-down picked from the muscles just trained; Start opens a guided,
// timed session.
export function StretchCard({
  muscles,
  now,
}: {
  muscles: TrainedMuscle[];
  now: number;
}) {
  const options = muscles.flatMap((m) => {
    const key = muscleKey(m.name);
    if (!key) return [];
    const ago = m.lastTrainedAt === null ? Infinity : now - m.lastTrainedAt;
    return [{ key, name: m.name, recent: ago >= 0 && ago < RECENT_MS }];
  });
  const recent = options.filter((o) => o.recent).map((o) => o.key);
  // Follows what was just trained until the user picks for themselves.
  const [picked, setPicked] = useState<MuscleKey[] | null>(null);
  const chosen = picked ?? recent;
  const [hold, setHold] = useState<Hold>(savedHold);
  const [session, setSession] = useState(0);
  const steps = stretchSteps(chosen, hold);
  const count = STRETCHES.filter((s) => chosen.includes(s.muscle)).length;

  const toggle = (key: MuscleKey) =>
    setPicked(
      chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key],
    );
  return (
    <section className="card stretch-card" aria-labelledby="stretch-title">
      <SectionTitle
        id="stretch-title"
        title="Cool-down stretches"
        detail={
          recent.length
            ? "Picked from what you trained in the last day and a half."
            : "Pick the muscles you want to stretch."
        }
        action={
          <span className="icon-tile blue">
            <PersonStanding size={22} />
          </span>
        }
      />
      <div className="stretch-muscles" role="group" aria-label="Muscles">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="chip capitalize"
            aria-pressed={chosen.includes(o.key)}
            onClick={() => toggle(o.key)}
          >
            {o.name}
          </button>
        ))}
      </div>
      <div className="row spaced stretch-length">
        <div className="segmented" role="group" aria-label="Hold each stretch">
          {HOLDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === hold}
              onClick={() => {
                setHold(s);
                localStorage.setItem(HOLD_KEY, String(s));
              }}
            >
              {s} s
            </button>
          ))}
        </div>
        <span className="muted small">
          {count} {count === 1 ? "stretch" : "stretches"} ·{" "}
          {clock(stepsMs(steps))}
        </span>
      </div>
      <button
        type="button"
        className="primary-button stretch-start"
        disabled={!steps.length}
        onClick={() => {
          // From the tap so iOS lets the tones play later.
          primeAudio();
          setSession((n) => n + 1);
        }}
      >
        <Play size={18} aria-hidden /> Start cool-down
      </button>
      {session > 0 && (
        <StretchRun key={session} steps={steps} onClose={() => setSession(0)} />
      )}
    </section>
  );
}

type Timing = { startedAt: number; pausedAt: number; pausedMs: number };
const elapsed = (t: Timing, at: number) =>
  (t.pausedAt || at) - t.startedAt - t.pausedMs;

export function StretchRun({
  steps,
  onClose,
}: {
  steps: StretchStep[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Fixed for the session even if the card's choice changes underneath.
  const [list] = useState(steps);
  const [timing, setTiming] = useState<Timing>(() => ({
    startedAt: Date.now(),
    pausedAt: 0,
    pausedMs: 0,
  }));
  const [now, setNow] = useState(() => Date.now());
  const [spoken, setSpoken] = useState(() => announce(list[0] ?? null));
  const cue = useRef(0);
  const paused = timing.pausedAt > 0;
  const total = stepsMs(list);
  const current = stepAt(list, elapsed(timing, now));
  const holds = list.filter((s) => s.kind === "hold").length;
  const stretches = new Set(list.map((s) => s.stretch.id)).size;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  useWakeLock();

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const at = stepAt(list, elapsed(timing, t));
      // Nothing left to count; Again starts a fresh interval.
      if (!at) clearInterval(id);
      const index = at ? at.index : list.length;
      if (index === cue.current) return;
      cue.current = index;
      tone(at ? (at.step.kind === "hold" ? 880 : 660) : 1320, at ? 0.3 : 0.9);
      navigator.vibrate?.(at ? 120 : [200, 100, 200]);
      setSpoken(announce(at?.step ?? null));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [list, timing]);

  const togglePause = () => {
    const t = Date.now();
    setTiming(
      paused
        ? {
            ...timing,
            pausedAt: 0,
            pausedMs: timing.pausedMs + t - timing.pausedAt,
          }
        : { ...timing, pausedAt: t },
    );
    setNow(t);
  };
  const skip = () => {
    if (!current) return;
    // Moving the start back makes the next step begin now.
    setTiming({ ...timing, startedAt: timing.startedAt - current.leftMs });
    setNow(Date.now());
  };
  const restart = () => {
    const t = Date.now();
    setTiming({ startedAt: t, pausedAt: 0, pausedMs: 0 });
    cue.current = 0;
    setSpoken(announce(list[0] ?? null));
    setNow(t);
  };
  const close = () => {
    const dialog = ref.current;
    if (dialog?.open && dialog.close) dialog.close();
    else onClose();
  };

  const step = current?.step;
  // The next position to move into, past the hold of the current one.
  const next = current
    ? list.slice(current.index + 1).find((s) => s.kind === "move")
    : undefined;
  // Each side is its own hold; while moving, the hold coming up shows.
  const number = current
    ? list.slice(0, current.index + 1).filter((s) => s.kind === "hold").length +
      (step?.kind === "move" ? 1 : 0)
    : holds;
  const fraction = current && step ? current.leftMs / step.ms : 0;
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <dialog
      ref={ref}
      className={`interval-run stretch-run ${step ? (step.kind === "hold" ? "work" : "prep") : "done"}`}
      aria-label="Cool-down"
      onClose={onClose}
    >
      <div className="interval-top">
        <span aria-hidden />
        <span className="sr-only" aria-live="polite">
          {spoken}
        </span>
        <button type="button" aria-label="Stop cool-down" onClick={close}>
          <X size={22} />
        </button>
      </div>
      {current && step ? (
        <div className="interval-face">
          <p className="interval-phase">
            {step.kind === "hold" ? "Hold" : "Get into position"}
          </p>
          <h2 className="stretch-name">{step.stretch.name}</h2>
          {step.side && <p className="stretch-side">{sideLabel(step)}</p>}
          <div className="interval-dial stretch-dial">
            <svg viewBox="0 0 100 100" aria-hidden>
              <circle className="interval-track" cx={50} cy={50} r={R} />
              <circle
                className="interval-arc"
                cx={50}
                cy={50}
                r={R}
                strokeDasharray={C}
                strokeDashoffset={C * (1 - fraction)}
              />
            </svg>
            <span className="interval-clock">
              {Math.ceil(current.leftMs / 1000)}
            </span>
          </div>
          <p className="stretch-cue">{step.stretch.cue}</p>
          <p className="interval-round">
            Hold {number} of {holds}
            {paused && " · Paused"}
          </p>
          <p className="interval-next">
            {next ? `Next: ${stepName(next)}` : "Last one"}
          </p>
          <div className="interval-controls">
            <button
              type="button"
              className="interval-main"
              aria-label={paused ? "Resume" : "Pause"}
              onClick={togglePause}
            >
              {paused ? <Play size={30} /> : <Pause size={30} />}
            </button>
            <button type="button" aria-label="Skip" onClick={skip}>
              <SkipForward size={24} />
            </button>
          </div>
        </div>
      ) : (
        <div className="interval-face">
          <p className="interval-phase">Done</p>
          <p className="interval-clock done-clock">{clock(total)}</p>
          <p className="interval-round">
            {stretches} {stretches === 1 ? "stretch" : "stretches"}
          </p>
          <div className="interval-controls">
            <button type="button" className="soft-button" onClick={restart}>
              Again
            </button>
            <button type="button" className="primary-button" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
      {current && (
        <p className="interval-total">
          {clock(Math.max(0, total - elapsed(timing, now)))} left
        </p>
      )}
    </dialog>
  );
}
