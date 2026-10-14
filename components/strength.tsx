"use client";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  Disc3,
  Flame,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Empty, Sheet, useClock, useTask } from "./ui";
import { LineChart } from "./line-chart";
import { BAR_KG, loadBar } from "@/lib/plates";
import { warmupSets } from "@/lib/warmup";
import type { NextSet } from "./rest-timer";

export type Exercise = FunctionReturnType<
  typeof api.strength.exercises
>[number];
const TARGET_ICON = {
  start: Plus,
  add_reps: Plus,
  add_weight: TrendingUp,
  deload: TrendingDown,
  return: RotateCcw,
};

// `done` is a local check-off for the rest timer; it is never saved.
export type SetDraft = { reps: number; weightKg: number; done?: boolean };
// `fresh` entries take their sets from the next target once it loads.
export type EntryDraft = {
  exercise: Exercise;
  sets: SetDraft[];
  fresh?: boolean;
};
type MuscleRef = { _id: Id<"muscles">; name: string };

const shortDay = (t: number) =>
  new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
export const kg = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const setLabel = (s: SetDraft) =>
  s.weightKg > 0 ? `${s.reps} × ${kg(s.weightKg)} kg` : `${s.reps} reps`;

// "3 × 8 @ 60 kg" when every set matches, "60 kg × 10, 8, 8" when only the
// weight does, otherwise each set in order.
export function setsSummary(sets: SetDraft[]) {
  const w = sets[0].weightKg;
  const sameWeight = sets.every((s) => s.weightKg === w);
  const sameReps = sets.every((s) => s.reps === sets[0].reps);
  if (sameWeight && sameReps && sets.length > 1)
    return w > 0
      ? `${sets.length} × ${sets[0].reps} @ ${kg(w)} kg`
      : `${sets.length} × ${sets[0].reps}`;
  if (sameWeight && sets.length > 1) {
    const reps = sets.map((s) => s.reps).join(", ");
    return w > 0 ? `${kg(w)} kg × ${reps}` : `${reps} reps`;
  }
  return sets.map(setLabel).join(", ");
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) =>
    Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <Minus size={15} />
      </button>
      <label>
        <span className="sr-only">{label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step="any"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
      </label>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

export function EntryEditor({
  entry,
  index,
  onChange,
  onRemove,
  onHistory,
  onRest,
}: {
  entry: EntryDraft;
  index: number;
  onChange: (sets: SetDraft[]) => void;
  onRemove: () => void;
  onHistory: () => void;
  onRest: (next: NextSet | null) => void;
}) {
  const { sets, exercise } = entry;
  const [showPlates, setShowPlates] = useState(false);
  const [showWarmup, setShowWarmup] = useState(false);
  const next = sets.find((s) => !s.done) ?? sets[sets.length - 1];
  // Ramp up to the heaviest set planned.
  const top = sets.reduce((a, b) => (b.weightKg > a.weightKg ? b : a));
  const warmup = warmupSets(top.weightKg, top.reps);
  const last = useQuery(api.strength.exerciseHistory, {
    exerciseId: exercise._id,
    limit: 1,
  })?.sessions[0];
  // Rounded up to 5 minutes so the subscription stays put between ticks.
  const now = Math.ceil(useClock() / 300_000) * 300_000;
  const target = useQuery(api.strength.nextTarget, {
    exerciseId: exercise._id,
    now,
  });
  const fresh = entry.fresh;
  useEffect(() => {
    if (fresh && target) onChange(target.sets);
  }, [fresh, target, onChange]);
  const TargetIcon = target ? TARGET_ICON[target.kind] : Plus;
  const update = (i: number, patch: Partial<SetDraft>) =>
    onChange(sets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="entry-editor">
      <div className="entry-head">
        <button type="button" className="entry-name" onClick={onHistory}>
          <strong>{exercise.name}</strong>
          <span className="muted small capitalize">
            {exercise.muscles.join(" · ")}
          </span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${exercise.name}`}
          onClick={onRemove}
        >
          <X size={18} />
        </button>
      </div>
      {last && (
        <div className="entry-last">
          <span className="muted small">
            Last{" "}
            {new Date(last.trainedAt).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}
            : {setsSummary(last.sets)}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange(
                last.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg })),
              )
            }
          >
            Repeat
          </button>
        </div>
      )}
      {target && (
        <div className={`entry-target ${target.kind}`}>
          <TargetIcon size={16} aria-hidden />
          <span>
            <strong>Target {setsSummary(target.sets)}</strong>
            <span className="muted small">{target.reason}</span>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(target.sets)}
          >
            Use
          </button>
        </div>
      )}
      <div className="set-head" aria-hidden>
        <span>Set</span>
        <span>Reps</span>
        <span>kg</span>
      </div>
      <ol className="set-rows" aria-label={`${exercise.name} sets`}>
        {sets.map((s, i) => (
          <li key={i} className={s.done ? "is-done" : undefined}>
            <button
              type="button"
              className="set-done"
              aria-pressed={!!s.done}
              aria-label={`Set ${i + 1} done`}
              onClick={() => {
                update(i, { done: !s.done });
                if (s.done) return;
                const j = sets.findIndex((x, k) => k !== i && !x.done);
                onRest(
                  j < 0
                    ? null
                    : {
                        name: exercise.name,
                        set: j + 1,
                        reps: sets[j].reps,
                        weightKg: sets[j].weightKg,
                      },
                );
              }}
            >
              {s.done ? <Check size={15} strokeWidth={3} /> : i + 1}
            </button>
            <Stepper
              label={`set ${i + 1} reps, exercise ${index + 1}`}
              value={s.reps}
              step={1}
              min={1}
              max={100}
              onChange={(reps) => update(i, { reps: Math.round(reps) })}
            />
            <Stepper
              label={`set ${i + 1} kilograms, exercise ${index + 1}`}
              value={s.weightKg}
              step={2.5}
              min={0}
              max={1000}
              onChange={(weightKg) => update(i, { weightKg })}
            />
            <button
              type="button"
              className="icon-button set-remove"
              aria-label={`Remove set ${i + 1}`}
              disabled={sets.length === 1}
              onClick={() => onChange(sets.filter((_, j) => j !== i))}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ol>
      <div className="entry-actions">
        <button
          type="button"
          className="text-button"
          disabled={sets.length >= 20}
          onClick={() =>
            onChange([...sets, { ...sets[sets.length - 1], done: false }])
          }
        >
          <Plus size={15} /> Add set
        </button>
        <span className="entry-tools">
          {warmup.length > 0 && (
            <button
              type="button"
              className="text-button"
              aria-expanded={showWarmup}
              onClick={() => setShowWarmup((v) => !v)}
            >
              <Flame size={15} /> Warm-up
            </button>
          )}
          {next.weightKg >= BAR_KG && (
            <button
              type="button"
              className="text-button"
              aria-expanded={showPlates}
              onClick={() => setShowPlates((v) => !v)}
            >
              <Disc3 size={15} /> Plates
            </button>
          )}
        </span>
      </div>
      {showWarmup && warmup.length > 0 && <Warmup sets={warmup} work={top} />}
      {showPlates && next.weightKg >= BAR_KG && (
        <Plates totalKg={next.weightKg} />
      )}
    </div>
  );
}

const PLATE_SIZE: Record<number, [width: number, height: number]> = {
  25: [16, 50],
  20: [14, 50],
  15: [12, 44],
  10: [11, 36],
  5: [9, 28],
  2.5: [8, 22],
  1.25: [7, 18],
};

const plateKg = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Lighter sets before the working weight. They aren't logged.
function Warmup({
  sets,
  work,
}: {
  sets: ReturnType<typeof warmupSets>;
  work: SetDraft;
}) {
  return (
    <figure className="warmup">
      <figcaption className="small">
        <strong>Warm-up</strong>
        <span className="muted">
          {" "}
          · before {kg(work.weightKg)} kg × {work.reps}, not logged
        </span>
      </figcaption>
      <ol>
        {sets.map((s) => {
          const { perSide } = loadBar(s.weightKg);
          return (
            <li key={s.label}>
              <strong>{s.label}</strong>
              <span className="muted small">
                {perSide.length
                  ? `${perSide.map(plateKg).join(" + ")} kg a side`
                  : "Empty bar"}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

// One side of an Olympic bar, loaded from the collar out.
function Plates({ totalKg }: { totalKg: number }) {
  const { perSide, remainderKg } = loadBar(totalKg);
  const starts = perSide.reduce<number[]>(
    (xs, _, i) => [
      ...xs,
      i ? xs[i - 1] + PLATE_SIZE[perSide[i - 1]][0] + 1 : 64,
    ],
    [],
  );
  const plates = perSide.map((plate, i) => {
    const [w, h] = PLATE_SIZE[plate];
    return (
      <rect
        key={i}
        className={`plate plate-${String(plate).replace(".", "-")}`}
        x={starts[i]}
        y={27 - h / 2}
        width={w}
        height={h}
        rx={2}
      />
    );
  });
  const text = perSide.length
    ? `Per side: ${perSide.map(plateKg).join(" + ")} kg`
    : "Just the bar";
  return (
    <figure className="plates">
      <svg viewBox="0 0 200 54" aria-hidden>
        <rect className="bar" x={4} y={24} width={56} height={6} rx={2} />
        <rect className="bar" x={56} y={18} width={8} height={18} rx={2} />
        <rect className="bar" x={64} y={22.5} width={132} height={9} rx={2} />
        {plates}
      </svg>
      <figcaption className="small">
        <strong>{kg(totalKg)} kg</strong> · {text}
        {remainderKg > 0 && (
          <span className="muted">
            {" "}
            · {kg(remainderKg)} kg won’t load with standard plates
          </span>
        )}
        <span className="muted"> · {BAR_KG} kg bar</span>
      </figcaption>
    </figure>
  );
}

export function ExercisePicker({
  open,
  onClose,
  exercises,
  muscles,
  chosen,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  muscles: MuscleRef[];
  chosen: Id<"exercises">[];
  onPick: (exercise: Exercise) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <PickerBody
        exercises={exercises}
        muscles={muscles}
        chosen={chosen}
        onPick={(e) => {
          onPick(e);
          onClose();
        }}
      />
    </Sheet>
  );
}

function PickerBody({
  exercises,
  muscles,
  chosen,
  onPick,
}: {
  exercises: Exercise[];
  muscles: MuscleRef[];
  chosen: Id<"exercises">[];
  onPick: (exercise: Exercise) => void;
}) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = exercises.filter(
    (e) =>
      (!q || e.name.toLowerCase().includes(q)) &&
      (!muscle || e.muscles.includes(muscle)),
  );
  return (
    <div className="picker">
      <label className="search-field">
        <Search size={17} aria-hidden />
        <span className="sr-only">Search exercises</span>
        <input
          type="search"
          placeholder="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="chip-row" role="group" aria-label="Filter by muscle">
        {muscles.map((m) => (
          <button
            key={m._id}
            type="button"
            className="chip capitalize"
            aria-pressed={muscle === m.name}
            onClick={() => setMuscle(muscle === m.name ? null : m.name)}
          >
            {m.name}
          </button>
        ))}
      </div>
      <ul className="picker-list">
        {shown.map((e) => {
          const added = chosen.includes(e._id);
          return (
            <li key={e._id}>
              <button type="button" disabled={added} onClick={() => onPick(e)}>
                <span>
                  <strong>{e.name}</strong>
                  <span className="muted small capitalize">
                    {e.muscles.join(" · ")}
                    {e.custom ? " · custom" : ""}
                  </span>
                </span>
                {added ? <Check size={18} /> : <Plus size={18} />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li>
            <Empty>No exercises match.</Empty>
          </li>
        )}
      </ul>
      {creating ? (
        <CustomExerciseForm
          muscles={muscles}
          initialName={query}
          onCreated={(e) => onPick(e)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          className="secondary-button full"
          onClick={() => setCreating(true)}
        >
          <Plus size={17} /> Create{" "}
          {query.trim() ? `“${query.trim()}”` : "a custom exercise"}
        </button>
      )}
    </div>
  );
}

function CustomExerciseForm({
  muscles,
  initialName,
  onCreated,
  onCancel,
}: {
  muscles: MuscleRef[];
  initialName: string;
  onCreated: (exercise: Exercise) => void;
  onCancel: () => void;
}) {
  const addExercise = useMutation(api.strength.addExercise);
  const { run, pending } = useTask();
  const [name, setName] = useState(initialName.trim());
  const [targets, setTargets] = useState<Id<"muscles">[]>([]);
  const nameId = useId();
  return (
    <form
      className="custom-exercise"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const id = await addExercise({ name, muscleIds: targets });
          onCreated({
            _id: id,
            name: name.trim(),
            custom: true,
            muscles: muscles
              .filter((m) => targets.includes(m._id))
              .map((m) => m.name),
          });
        }, `Created ${name.trim()}`);
      }}
    >
      <label htmlFor={nameId}>Exercise name</label>
      <input
        id={nameId}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <fieldset>
        <legend>Muscles it works</legend>
        <div className="muscle-picker">
          {muscles.map((m) => {
            const on = targets.includes(m._id);
            return (
              <button
                type="button"
                key={m._id}
                className={on ? "selected" : ""}
                aria-pressed={on}
                onClick={() =>
                  setTargets(
                    on
                      ? targets.filter((t) => t !== m._id)
                      : [...targets, m._id],
                  )
                }
              >
                {on && <Check size={14} />}
                {m.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="row form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button grow"
          disabled={pending || !name.trim() || targets.length === 0}
        >
          Create and add
        </button>
      </div>
    </form>
  );
}

export function SessionSets({ workoutId }: { workoutId: Id<"workouts"> }) {
  const session = useQuery(api.strength.session, { workoutId });
  if (!session?.entries.length) return null;
  return (
    <ul className="session-sets">
      {session.entries.map((e) => (
        <li key={e.exerciseId}>
          <span>{e.name}</span>{" "}
          <span className="muted">{setsSummary(e.sets)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExerciseHistorySheet({
  exercise,
  onClose,
}: {
  exercise: { _id: Id<"exercises">; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={exercise !== null}
      onClose={onClose}
      title={exercise?.name ?? ""}
    >
      {exercise && <ExerciseHistory exerciseId={exercise._id} />}
    </Sheet>
  );
}

function ExerciseHistory({ exerciseId }: { exerciseId: Id<"exercises"> }) {
  const history = useQuery(api.strength.exerciseHistory, {
    exerciseId,
    limit: 30,
  });
  if (!history)
    return (
      <p role="status" className="muted">
        Loading…
      </p>
    );
  if (!history.sessions.length)
    return <Empty>No sets logged yet. Your progress will chart here.</Empty>;
  const weighted = history.prE1rm > 0;
  return (
    <>
      {weighted && (
        <div className="stat-grid pr-stats">
          <div className="stat">
            <span className="muted small">
              <Trophy size={13} /> Best e1RM
            </span>
            <strong>
              {kg(history.prE1rm)}
              <small> kg</small>
            </strong>
            {history.prAt && (
              <span className="muted small">
                {new Date(history.prAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
          <div className="stat">
            <span className="muted small">Heaviest set</span>
            <strong>
              {kg(history.prWeightKg)}
              <small> kg</small>
            </strong>
          </div>
          <div className="stat">
            <span className="muted small">Sessions</span>
            <strong>{history.sessions.length}</strong>
          </div>
        </div>
      )}
      {weighted && history.sessions.length > 1 && (
        <LineChart
          className="e1rm-chart"
          title={<span className="small">Estimated 1RM per session</span>}
          points={history.sessions
            .filter((s) => s.bestE1rm > 0)
            .map((s) => ({ key: s.workoutId, t: s.trainedAt, v: s.bestE1rm }))
            .sort((a, b) => a.t - b.t)}
          format={kg}
          summary={`Best ${kg(history.prE1rm)} kg`}
          describe={(p) =>
            `${shortDay(p.t)} · ${kg(p.v)} kg${p.t === history.prAt ? " · PR" : ""}`
          }
          label={`Estimated one-rep max per session; best ${kg(history.prE1rm)} kilograms.`}
          highlight={
            history.sessions.find((s) => s.trainedAt === history.prAt)
              ?.workoutId
          }
        />
      )}
      <h3 className="sheet-subhead">Sessions</h3>
      <ul className="entry-list history-sessions">
        {history.sessions.map((s) => (
          <li key={s.workoutId}>
            <div>
              <strong>
                {new Date(s.trainedAt).toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                {s.trainedAt === history.prAt && weighted && (
                  <span className="pill green pr-pill">
                    <Trophy size={11} /> PR
                  </span>
                )}
              </strong>
              <p className="muted small">{setsSummary(s.sets)}</p>
            </div>
            {weighted && (
              <span className="small session-e1rm">
                {kg(s.bestE1rm)} kg
                <span className="muted"> e1RM</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        e1RM estimates your one-rep max from each set (Epley: weight × (1 + reps
        ⁄ 30)).
      </p>
    </>
  );
}
