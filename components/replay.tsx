"use client";
import { useQuery } from "convex/react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  REPLAY_HOURS,
  replayWindow,
  sessionBefore,
  statesAt,
} from "@/lib/replay";
import {
  BodyModel,
  muscleKey,
  type MuscleKey,
  type MuscleState,
} from "./body3d";
import { SectionTitle } from "./ui";

type Muscle = {
  _id: Id<"muscles">;
  name: string;
  lastTrainedAt: number | null;
  cooldownHours: number;
};

const HOUR = 3_600_000;
const pct = (hours: number) => `${(hours / REPLAY_HOURS) * 100}%`;
const when = (at: number) =>
  new Date(at).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
  });

function earlier(hours: number) {
  if (hours === 0) return "this hour";
  if (hours < 24) return `${hours} h earlier`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} earlier`;
}

export function RecoveryReplay({
  muscles,
  now,
}: {
  muscles: Muscle[];
  now: number;
}) {
  const { startMs, endMs, readFromMs } = replayWindow(now, muscles);
  const data = useQuery(api.insights.range, {
    startMs: readFromMs,
    endMs,
  });
  // Hours before the window end, so the scrubbed point holds as time passes.
  const [hoursAgo, setHoursAgo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const running = playing && hoursAgo > 0;

  useEffect(() => {
    if (!running) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Two weeks in about eight seconds, or a day at a time without motion.
    const step = reduce ? 24 : 2;
    const timer = setInterval(
      () => setHoursAgo((h) => Math.max(0, h - step)),
      reduce ? 700 : 50,
    );
    return () => clearInterval(timer);
  }, [running]);

  const at = endMs - hoursAgo * HOUR;
  const workouts = data?.workouts ?? [];
  const states = statesAt(muscles, workouts, at, data?.trainedBefore ?? true);
  const keyed: Partial<Record<MuscleKey, MuscleState>> = {};
  for (const m of muscles) {
    const key = muscleKey(m.name);
    const state = states.get(m._id);
    if (key && state) keyed[key] = state;
  }
  const names = new Map(muscles.map((m) => [m._id as string, m.name]));
  const sessions = workouts
    .filter((w) => w.trainedAt >= startMs && w.trainedAt < endMs)
    .sort((a, b) => a.trainedAt - b.trainedAt);
  const last = sessionBefore(sessions, at, startMs);
  const recovering = [...states.values()].filter(
    (s) => s.kind === "recovering",
  ).length;
  // Land just after a session so its muscles show as freshly trained.
  const hoursAgoOf = (trainedAt: number) =>
    Math.max(0, Math.floor((endMs - trainedAt) / HOUR));
  const prev = [...sessions]
    .reverse()
    .find((w) => hoursAgoOf(w.trainedAt) > hoursAgo);
  const next = sessions.find((w) => hoursAgoOf(w.trainedAt) < hoursAgo);

  return (
    <section className="card replay" aria-labelledby="replay-title">
      <SectionTitle
        title="Recovery replay"
        id="replay-title"
        detail="Scrub back through two weeks of training."
      />
      <BodyModel states={keyed} height={300} />
      <div className="replay-readout" aria-live="polite">
        <strong>{hoursAgo === 0 ? "Now" : when(at)}</strong>
        <span className="muted">
          {recovering ? `${recovering} recovering` : "Everything rested"}
          {last
            ? ` · Last session ${earlier(hoursAgoOf(last.trainedAt) - hoursAgo)}: ${last.muscleIds
                .map((id) => names.get(id))
                .filter(Boolean)
                .join(", ")}`
            : ""}
        </span>
      </div>
      <div className="replay-scrubber">
        <input
          type="range"
          aria-label="Replay time"
          aria-valuetext={hoursAgo === 0 ? "Now" : when(at)}
          min={0}
          max={REPLAY_HOURS}
          step={1}
          value={REPLAY_HOURS - hoursAgo}
          onChange={(e) => {
            setPlaying(false);
            setHoursAgo(REPLAY_HOURS - Number(e.target.value));
          }}
        />
        <div className="replay-sessions" aria-hidden>
          {sessions.map((w, i) => (
            <i
              key={i}
              style={{ left: pct(REPLAY_HOURS - hoursAgoOf(w.trainedAt)) }}
            />
          ))}
        </div>
        <div className="replay-ends muted" aria-hidden>
          <span>2 weeks ago</span>
          <span>Now</span>
        </div>
      </div>
      <div className="replay-controls">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous session"
          disabled={!prev}
          onClick={() => {
            setPlaying(false);
            if (prev) setHoursAgo(hoursAgoOf(prev.trainedAt));
          }}
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          className="soft-button"
          aria-pressed={running}
          disabled={!data}
          onClick={() => {
            if (running) return setPlaying(false);
            if (hoursAgo === 0) setHoursAgo(REPLAY_HOURS);
            setPlaying(true);
          }}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? "Pause" : hoursAgo ? "Play from here" : "Play two weeks"}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next session"
          disabled={!next}
          onClick={() => {
            setPlaying(false);
            if (next) setHoursAgo(hoursAgoOf(next.trainedAt));
          }}
        >
          <SkipForward size={18} />
        </button>
      </div>
    </section>
  );
}
