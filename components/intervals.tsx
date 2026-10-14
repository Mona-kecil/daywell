"use client";
import {
  AlarmClock,
  Flame,
  Hourglass,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeOff,
  Wind,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  LIMITS,
  PRESETS,
  phaseAt,
  phases,
  planSeconds,
  totalMs,
  validPlan,
  type IntervalPlan,
  type Phase,
} from "@/lib/intervals";
import { primeAudio, tone, useWakeLock } from "./session-kit";
import { Stepper } from "./strength";
import { SectionTitle } from "./ui";

const PLAN_KEY = "daywell.intervals";
const VOICE_KEY = "daywell.intervalVoice";
const TICK_MS = 100;

function savedPlan() {
  try {
    return validPlan(JSON.parse(localStorage.getItem(PLAN_KEY) ?? "null"));
  } catch {
    return null;
  }
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const samePlan = (a: IntervalPlan, b: IntervalPlan) =>
  a.workS === b.workS && a.restS === b.restS && a.rounds === b.rounds;
export const planLabel = (p: IntervalPlan) =>
  p.restS
    ? `${p.workS}s / ${p.restS}s × ${p.rounds}`
    : `${p.workS}s × ${p.rounds}`;

type Timing = { startedAt: number; pausedAt: number; pausedMs: number };
const elapsed = (t: Timing, at: number) =>
  (t.pausedAt || at) - t.startedAt - t.pausedMs;
const voiceOn = () =>
  typeof localStorage !== "undefined" &&
  localStorage.getItem(VOICE_KEY) === "1";

function say(text: string) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

const KIND = {
  prep: { label: "Get ready", Icon: Hourglass },
  work: { label: "Work", Icon: Flame },
  rest: { label: "Rest", Icon: Wind },
} as const;

export function announce(phase: Phase | null, rounds: number) {
  if (!phase) return "Done. Nice work.";
  if (phase.kind === "prep") return "Get ready";
  if (phase.kind === "rest") return "Rest";
  return phase.round === rounds
    ? `Work. Last round.`
    : `Work. Round ${phase.round} of ${rounds}.`;
}

// Settings for work/rest rounds; Start opens a full-screen countdown.
export function IntervalCard() {
  // Train only renders on the client, once its data has loaded.
  const [plan, setPlan] = useState<IntervalPlan>(
    () => savedPlan() ?? PRESETS[0].plan,
  );
  const [session, setSession] = useState(0);
  const update = (next: IntervalPlan) => {
    setPlan(next);
    localStorage.setItem(PLAN_KEY, JSON.stringify(next));
  };
  const start = () => {
    // Started from the tap so iOS lets the beeps and voice play later.
    primeAudio();
    if (voiceOn() && typeof speechSynthesis !== "undefined")
      speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    setSession((n) => n + 1);
  };
  const field = (key: keyof IntervalPlan, label: string, step: number) => (
    <div className="interval-field">
      <span aria-hidden>{label}</span>
      <Stepper
        label={label.toLowerCase()}
        value={plan[key]}
        step={step}
        min={LIMITS[key][0]}
        max={LIMITS[key][1]}
        onChange={(n) => update({ ...plan, [key]: Math.round(n) })}
      />
    </div>
  );
  return (
    <section className="card intervals-card" aria-labelledby="intervals-title">
      <SectionTitle
        id="intervals-title"
        title="Interval timer"
        detail="Work and rest rounds, with a beep at every switch."
        action={
          <span className="icon-tile amber">
            <AlarmClock size={22} />
          </span>
        }
      />
      <div className="interval-presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={samePlan(plan, p.plan)}
            onClick={() => update(p.plan)}
          >
            <strong>{p.label}</strong>
            <span>{planLabel(p.plan)}</span>
          </button>
        ))}
      </div>
      <div className="interval-fields">
        {field("workS", "Work seconds", 5)}
        {field("restS", "Rest seconds", 5)}
        {field("rounds", "Rounds", 1)}
      </div>
      <div className="row spaced interval-start">
        <span className="muted small">
          {plan.rounds} {plan.rounds === 1 ? "round" : "rounds"} ·{" "}
          {clock(planSeconds(plan))} total
        </span>
        <button type="button" className="primary-button" onClick={start}>
          <Play size={18} aria-hidden /> Start
        </button>
      </div>
      {session > 0 && (
        <IntervalRun key={session} plan={plan} onClose={() => setSession(0)} />
      )}
    </section>
  );
}

export function IntervalRun({
  plan,
  onClose,
}: {
  plan: IntervalPlan;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [list] = useState(() => phases(plan));
  // Elapsed time is wall-clock based so a throttled tab doesn't drift.
  const [timing, setTiming] = useState<Timing>(() => ({
    startedAt: Date.now(),
    pausedAt: 0,
    pausedMs: 0,
  }));
  const [now, setNow] = useState(() => Date.now());
  const paused = timing.pausedAt > 0;
  const [voice, setVoice] = useState(voiceOn);
  const [spoken, setSpoken] = useState(() =>
    announce(list[0] ?? null, plan.rounds),
  );
  const cue = useRef({ index: 0, second: -1 });
  const left = totalMs(list) - elapsed(timing, now);
  const current = phaseAt(list, elapsed(timing, now));

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  useWakeLock();

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const at = phaseAt(list, elapsed(timing, t));
      const index = at ? at.index : list.length;
      if (index !== cue.current.index) {
        cue.current = { index, second: -1 };
        tone(at ? 880 : 1320, at ? 0.45 : 0.9);
        navigator.vibrate?.(at ? 250 : [200, 100, 200, 100, 400]);
        const text = announce(at?.phase ?? null, plan.rounds);
        setSpoken(text);
        if (voiceOn()) say(text);
        return;
      }
      // Short beeps on the last three seconds of each phase.
      const second = at ? Math.ceil(at.leftMs / 1000) : 0;
      if (second <= 3 && second >= 1 && second !== cue.current.second) {
        cue.current.second = second;
        tone(660, 0.12);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [list, plan.rounds, timing]);

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
    // Moving the start back makes the next phase begin now.
    setTiming({ ...timing, startedAt: timing.startedAt - current.leftMs });
    setNow(Date.now());
  };
  const restart = () => {
    const t = Date.now();
    setTiming({ startedAt: t, pausedAt: 0, pausedMs: 0 });
    cue.current = { index: 0, second: -1 };
    setSpoken(announce(list[0] ?? null, plan.rounds));
    setNow(t);
  };
  const close = () => {
    const dialog = ref.current;
    if (dialog?.open && dialog.close) dialog.close();
    else onClose();
  };
  const toggleVoice = () => {
    localStorage.setItem(VOICE_KEY, voice ? "0" : "1");
    setVoice(!voice);
  };

  const phase = current?.phase;
  const kind = phase ? KIND[phase.kind] : null;
  const seconds = current ? Math.ceil(current.leftMs / 1000) : 0;
  const fraction = current && phase ? current.leftMs / phase.ms : 0;
  const next = current ? list[current.index + 1] : undefined;
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <dialog
      ref={ref}
      className={`interval-run ${phase?.kind ?? "done"}`}
      aria-label="Interval timer"
      onClose={onClose}
    >
      <div className="interval-top">
        <button
          type="button"
          aria-label={voice ? "Turn voice cues off" : "Turn voice cues on"}
          aria-pressed={voice}
          onClick={toggleVoice}
        >
          {voice ? <Volume2 size={22} /> : <VolumeOff size={22} />}
        </button>
        <span className="sr-only" aria-live="assertive">
          {spoken}
        </span>
        <button type="button" aria-label="Stop timer" onClick={close}>
          <X size={22} />
        </button>
      </div>
      {current && phase && kind ? (
        <div className="interval-face">
          <p className="interval-phase">
            <kind.Icon size={22} aria-hidden /> {kind.label}
          </p>
          <div className="interval-dial">
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
            <span className="interval-clock">{clock(seconds)}</span>
          </div>
          <p className="interval-round">
            Round {phase.round} of {plan.rounds}
            {paused && " · Paused"}
          </p>
          <p className="interval-next">
            {next
              ? `Next: ${KIND[next.kind].label.toLowerCase()} ${next.ms / 1000} s`
              : "Last stretch"}
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
            <button
              type="button"
              aria-label={`Skip ${kind.label.toLowerCase()}`}
              onClick={skip}
            >
              <SkipForward size={24} />
            </button>
          </div>
        </div>
      ) : (
        <div className="interval-face">
          <p className="interval-phase">Done</p>
          <p className="interval-clock done-clock">
            {clock(planSeconds(plan))}
          </p>
          <p className="interval-round">
            {plan.rounds} {plan.rounds === 1 ? "round" : "rounds"} of{" "}
            {planLabel(plan)}
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
          {clock(Math.ceil(left / 1000))} left in total
        </p>
      )}
    </dialog>
  );
}
