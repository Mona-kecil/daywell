"use client";
import { Pause, Play, Volume2, VolumeOff, Wind, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  MINUTES,
  PATTERNS,
  breathAt,
  cycleMs,
  cyclesFor,
  fullness,
  patternLabel,
  type BreathPattern,
  type BreathStep,
} from "@/lib/breath";
import { primeAudio, tone, useWakeLock } from "./session-kit";
import { SectionTitle } from "./ui";

const KEY = "daywell.breath";
const SOUND_KEY = "daywell.breathSound";
const TICK_MS = 100;
// The orb never shrinks below this, so "empty" still reads as a shape.
const EMPTY = 0.42;
const WORDS: Record<BreathStep["kind"], string> = {
  in: "Breathe in",
  hold: "Hold",
  out: "Breathe out",
  rest: "Rest",
};

type Choice = { pattern: string; minutes: number };

function savedChoice(): Choice | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return PATTERNS.some((p) => p.id === c?.pattern) &&
      (MINUTES as readonly number[]).includes(c?.minutes)
      ? { pattern: c.pattern, minutes: c.minutes }
      : null;
  } catch {
    return null;
  }
}

const soundOn = () =>
  typeof localStorage !== "undefined" &&
  localStorage.getItem(SOUND_KEY) === "1";
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const breaths = (n: number) => `${n} ${n === 1 ? "breath" : "breaths"}`;

// Pattern and length; Start opens a full-screen paced-breathing session.
export function BreathCard() {
  // Today only renders on the client, once its data has loaded.
  const [choice, setChoice] = useState<Choice>(() => {
    const hour = new Date().getHours();
    // Late in the day, offer the wind-down pattern first.
    return (
      savedChoice() ?? {
        pattern: hour >= 20 || hour < 5 ? "478" : "box",
        minutes: 2,
      }
    );
  });
  const [session, setSession] = useState(0);
  const pattern = PATTERNS.find((p) => p.id === choice.pattern) ?? PATTERNS[0];
  const cycles = cyclesFor(pattern.steps, choice.minutes);
  const update = (next: Choice) => {
    setChoice(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };
  return (
    <section className="card breath-card" aria-labelledby="breath-title">
      <SectionTitle
        id="breath-title"
        title="Breathe"
        detail="A minute or more of slow, paced breathing."
        action={
          <span className="icon-tile blue">
            <Wind size={22} />
          </span>
        }
      />
      <div className="breath-patterns" role="group" aria-label="Pattern">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={p.id === pattern.id}
            onClick={() => update({ ...choice, pattern: p.id })}
          >
            <strong>{p.label}</strong>
            <span>{p.use}</span>
          </button>
        ))}
      </div>
      <div className="row spaced breath-length">
        <div className="segmented" role="group" aria-label="Minutes">
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === choice.minutes}
              onClick={() => update({ ...choice, minutes: m })}
            >
              {m} min
            </button>
          ))}
        </div>
        <span className="muted small">
          {breaths(cycles)} · {clock(cycles * cycleMs(pattern.steps))}
        </span>
      </div>
      <button
        type="button"
        className="primary-button breath-start"
        onClick={() => {
          // From the tap so iOS lets the tones play later.
          primeAudio();
          setSession((n) => n + 1);
        }}
      >
        <Play size={18} aria-hidden /> Start {pattern.label}
      </button>
      {session > 0 && (
        <BreathRun
          key={session}
          pattern={pattern}
          cycles={cycles}
          onClose={() => setSession(0)}
        />
      )}
    </section>
  );
}

type Timing = { startedAt: number; pausedAt: number; pausedMs: number };
const elapsed = (t: Timing, at: number) =>
  (t.pausedAt || at) - t.startedAt - t.pausedMs;

export function BreathRun({
  pattern,
  cycles,
  onClose,
}: {
  pattern: BreathPattern;
  cycles: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [timing, setTiming] = useState<Timing>(() => ({
    startedAt: Date.now(),
    pausedAt: 0,
    pausedMs: 0,
  }));
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(soundOn);
  const [spoken, setSpoken] = useState(WORDS[pattern.steps[0].kind]);
  // -1 so the first breath in is cued too.
  const cue = useRef(-1);
  const paused = timing.pausedAt > 0;
  const at = elapsed(timing, now);
  const current = breathAt(pattern.steps, cycles, at);
  const totalMs = cycles * cycleMs(pattern.steps);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  useWakeLock();

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const step = breathAt(pattern.steps, cycles, elapsed(timing, t));
      const index = step ? step.index : Infinity;
      if (index === cue.current) return;
      cue.current = index;
      if (!step) {
        if (soundOn()) tone(523, 1.2, 0.15);
        navigator.vibrate?.([60, 80, 60]);
        setSpoken(`Done. ${breaths(cycles)}.`);
        return;
      }
      const { kind } = step.step;
      if (soundOn() && (kind === "in" || kind === "out"))
        tone(kind === "in" ? 440 : 330, 0.7, 0.12);
      navigator.vibrate?.(kind === "in" || kind === "out" ? 40 : 15);
      setSpoken(WORDS[kind]);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [pattern.steps, cycles, timing]);

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
  const restart = () => {
    const t = Date.now();
    setTiming({ startedAt: t, pausedAt: 0, pausedMs: 0 });
    cue.current = -1;
    setSpoken(WORDS[pattern.steps[0].kind]);
    setNow(t);
  };
  const close = () => {
    const dialog = ref.current;
    if (dialog?.open && dialog.close) dialog.close();
    else onClose();
  };
  const toggleSound = () => {
    localStorage.setItem(SOUND_KEY, sound ? "0" : "1");
    setSound(!sound);
  };

  // While running, the orb eases to the end of the step in CSS over the time
  // left; paused (and on the first frame) it sits where the breath is now.
  let orb = { transform: `scale(${EMPTY})`, transitionDuration: "0ms" };
  if (current) {
    const { kind } = current.step;
    const still = paused || at < TICK_MS;
    const full = still
      ? fullness(kind, current.progress)
      : fullness(kind, kind === "in" || kind === "out" ? 1 : 0);
    orb = {
      transform: `scale(${EMPTY + (1 - EMPTY) * full})`,
      transitionDuration: still ? "0ms" : `${Math.round(current.leftMs)}ms`,
    };
  }

  return (
    <dialog
      ref={ref}
      className={`interval-run breath-run${current ? "" : " done"}`}
      aria-label="Breathing"
      onClose={onClose}
    >
      <div className="interval-top">
        <button
          type="button"
          aria-label={sound ? "Turn tones off" : "Turn tones on"}
          aria-pressed={sound}
          onClick={toggleSound}
        >
          {sound ? <Volume2 size={22} /> : <VolumeOff size={22} />}
        </button>
        <span className="sr-only" aria-live="polite">
          {spoken}
        </span>
        <button type="button" aria-label="Stop breathing" onClick={close}>
          <X size={22} />
        </button>
      </div>
      {current ? (
        <div className="interval-face">
          <p className="interval-phase">{WORDS[current.step.kind]}</p>
          <div className="breath-stage">
            <span className="breath-orb" style={orb} aria-hidden />
            <p className="breath-count">{Math.ceil(current.leftMs / 1000)}</p>
          </div>
          <p className="interval-round">
            Breath {current.breath} of {cycles}
            {paused && " · Paused"}
          </p>
          <p className="interval-next">
            {pattern.label} · {patternLabel(pattern.steps)}
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
          </div>
        </div>
      ) : (
        <div className="interval-face">
          <p className="interval-phase">Done</p>
          <p className="interval-clock done-clock">{clock(totalMs)}</p>
          <p className="interval-round">
            {breaths(cycles)} of {pattern.label}
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
          {clock(Math.max(0, totalMs - at))} left
        </p>
      )}
    </dialog>
  );
}
