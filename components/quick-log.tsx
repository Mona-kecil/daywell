"use client";
import { useAction, useConvex, useMutation } from "convex/react";
import {
  BookmarkCheck,
  Check,
  Droplets,
  Dumbbell,
  HeartPulse,
  Mic,
  MicOff,
  Minus,
  Plus,
  Sparkles,
  Utensils,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { QuickLogProposal } from "@/lib/quick-log";
import { validEaten } from "@/lib/saved-meals";
import { deviceTimeZone } from "./coach";
import { servingLabel } from "./saved-meals";
import { Sheet, timeLabel, useTask, useToast } from "./ui";

const EXAMPLE = "Drank 500 ml, trained back at 7am, had 2 eggs and toast";
const CHECKIN_KEYS = ["weightKg", "sleepHours", "mood", "energy"] as const;

export function QuickLogButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="quick-log-bar"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={18} aria-hidden />
        <span>Tell Daywell what you did…</span>
        <Mic size={18} aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Quick log">
        <QuickLog onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, RecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

// Web Speech dictation, where the browser offers it. Final phrases are appended.
function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const append = useRef(onText);
  useEffect(() => {
    append.current = onText;
  });
  useEffect(() => () => rec.current?.stop(), []);

  const toggle = () => {
    if (listening) return rec.current?.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language;
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) append.current(e.results[i][0].transcript);
    };
    r.onerror = (e) =>
      setError(
        e.error === "not-allowed"
          ? "Allow microphone access to dictate."
          : e.error === "no-speech"
            ? "Didn’t catch that. Try again."
            : "Dictation stopped.",
      );
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  };
  return { supported, listening, error, toggle };
}

type Draft = { proposal: QuickLogProposal; on: boolean };

function describe(p: QuickLogProposal) {
  switch (p.kind) {
    case "water":
      return { Icon: Droplets, tone: "blue", title: "Water" };
    case "workout":
      return { Icon: Dumbbell, tone: "green", title: "Workout" };
    case "meal":
      return { Icon: Utensils, tone: "amber", title: "Meal" };
    case "savedMeal":
      return { Icon: BookmarkCheck, tone: "amber", title: "Saved meal" };
    case "checkin":
      return { Icon: HeartPulse, tone: "green", title: "Check-in" };
  }
}

function checkinLine(p: Extract<QuickLogProposal, { kind: "checkin" }>) {
  return [
    p.weightKg !== undefined && `${p.weightKg} kg`,
    p.sleepHours !== undefined && `${p.sleepHours} h sleep`,
    p.mood !== undefined && `mood ${p.mood}/5`,
    p.energy !== undefined && `energy ${p.energy}/5`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function QuickLog({ onDone }: { onDone: () => void }) {
  const parse = useAction(api.quickLog.parse);
  const fromText = useAction(api.mealActions.createFromText);
  const addWater = useMutation(api.tracker.addWater),
    deleteWater = useMutation(api.tracker.deleteWater);
  const addWorkout = useMutation(api.tracker.addWorkout),
    deleteWorkout = useMutation(api.tracker.deleteWorkout);
  const deleteMeal = useMutation(api.meals.deleteMeal);
  const applySavedMeal = useMutation(api.quickLog.applySavedMeal);
  const upsertCheckin = useMutation(api.checkins.upsert);
  const convex = useConvex();
  const { run, pending } = useTask();
  const notify = useToast();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [leftover, setLeftover] = useState<string[]>([]);
  const dictation = useDictation((heard) =>
    setText((t) => (t.trim() ? `${t.trim()} ${heard.trim()}` : heard.trim())),
  );

  const understand = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || pending) return;
    if (dictation.listening) dictation.toggle();
    void run(async () => {
      const result = await parse({ text, timeZone: deviceTimeZone() });
      setDrafts(result.proposals.map((proposal) => ({ proposal, on: true })));
      setLeftover(result.leftover);
    });
  };

  const update = (index: number, change: Partial<Draft>) =>
    setDrafts((d) =>
      d ? d.map((x, i) => (i === index ? { ...x, ...change } : x)) : d,
    );

  // Saves one entry and returns how to take it back.
  const apply = async (
    p: QuickLogProposal,
  ): Promise<() => Promise<unknown>> => {
    switch (p.kind) {
      case "water": {
        const id = await addWater({ amountMl: p.amountMl, at: p.at });
        return () => deleteWater({ id });
      }
      case "workout": {
        const id = await addWorkout({
          muscleIds: p.muscleIds as Id<"muscles">[],
          trainedAt: p.at,
          note: p.note,
        });
        return () => deleteWorkout({ id });
      }
      case "meal": {
        const id = await fromText({
          description: p.description,
          at: p.at,
          items: p.items,
        });
        return () => deleteMeal({ id });
      }
      case "savedMeal": {
        const id = await applySavedMeal({
          savedMealId: p.savedMealId as Id<"savedMeals">,
          servings: p.servings,
          at: p.at,
        });
        return () => deleteMeal({ id });
      }
      case "checkin": {
        const before = await convex.query(api.checkins.get, { day: p.day });
        const fields = CHECKIN_KEYS.filter((k) => p[k] !== undefined);
        await upsertCheckin({
          day: p.day,
          ...Object.fromEntries(fields.map((k) => [k, p[k]])),
        });
        return () =>
          upsertCheckin({
            day: p.day,
            ...Object.fromEntries(fields.map((k) => [k, before?.[k] ?? null])),
          });
      }
    }
  };

  const chosen = drafts?.filter((d) => d.on) ?? [];
  const invalid = chosen.some(
    ({ proposal: p }) =>
      (p.kind === "water" && !(p.amountMl > 0 && p.amountMl <= 10_000)) ||
      (p.kind === "meal" && !p.description.trim()) ||
      (p.kind === "savedMeal" && !validEaten(p.servings)),
  );
  const logAll = () =>
    void run(async () => {
      const undos: (() => Promise<unknown>)[] = [];
      const done = new Set<Draft>();
      try {
        for (const draft of chosen) {
          undos.push(await apply(draft.proposal));
          done.add(draft);
        }
      } catch (error) {
        // Drop what saved so a retry can't log it twice.
        setDrafts((d) => d?.filter((x) => !done.has(x)) ?? d);
        const reason =
          error instanceof Error ? error.message : "Please try again.";
        notify(
          done.size
            ? `Logged ${done.size} of ${chosen.length}. ${reason}`
            : reason,
          true,
          done.size ? () => undoAll(undos) : undefined,
        );
        return;
      }
      notify(
        `Logged ${undos.length} ${undos.length === 1 ? "entry" : "entries"}`,
        false,
        () => undoAll(undos),
      );
      onDone();
    });

  return (
    <div className="quick-log">
      <form onSubmit={understand} className="quick-log-compose">
        <textarea
          aria-label="What did you do?"
          placeholder={EXAMPLE}
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDrafts(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)
              understand(e);
          }}
        />
        <div className="row spaced">
          {dictation.supported ? (
            <button
              type="button"
              className={`soft-button mic ${dictation.listening ? "live" : ""}`}
              aria-pressed={dictation.listening}
              onClick={dictation.toggle}
            >
              {dictation.listening ? <MicOff size={16} /> : <Mic size={16} />}
              {dictation.listening ? "Stop" : "Dictate"}
            </button>
          ) : (
            <span className="muted small">{text.length}/500</span>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={pending || !text.trim()}
          >
            <Sparkles size={16} />{" "}
            {pending && !drafts ? "Reading…" : "Understand"}
          </button>
        </div>
        {dictation.error && (
          <p role="alert" className="small quick-log-note">
            {dictation.error}
          </p>
        )}
      </form>

      {drafts && (
        <section aria-label="Proposed entries" className="quick-log-results">
          {drafts.length === 0 ? (
            <p className="muted small">
              Nothing to log in that. Try naming an amount, a muscle or a food.
            </p>
          ) : (
            <ul className="proposals">
              {drafts.map((d, i) => {
                const { Icon, tone, title } = describe(d.proposal);
                return (
                  <li key={i} className={d.on ? "" : "off"}>
                    <span className={`icon-tile ${tone}`}>
                      <Icon size={19} />
                    </span>
                    <div className="proposal-body">
                      <div className="row spaced">
                        <strong>{title}</strong>
                        {d.proposal.kind !== "checkin" && (
                          <span className="muted small">
                            {timeLabel(d.proposal.at)}
                          </span>
                        )}
                      </div>
                      <Detail
                        proposal={d.proposal}
                        onChange={(proposal) => update(i, { proposal })}
                      />
                    </div>
                    <button
                      type="button"
                      className="proposal-toggle"
                      aria-pressed={d.on}
                      aria-label={`Include ${title.toLowerCase()}`}
                      onClick={() => update(i, { on: !d.on })}
                    >
                      <Check size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {leftover.length > 0 && (
            <div className="leftover">
              <p className="small">
                <strong>Not logged</strong>
              </p>
              <ul className="muted small">
                {leftover.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {drafts.length > 0 && (
            <button
              type="button"
              className="primary-button full"
              disabled={pending || invalid || chosen.length === 0}
              onClick={logAll}
            >
              {pending
                ? "Logging…"
                : `Log ${chosen.length} ${chosen.length === 1 ? "entry" : "entries"}`}
            </button>
          )}
          {drafts.some((d) => d.on && d.proposal.kind === "meal") && (
            <p className="muted small quick-log-note">
              Meals are matched against USDA FoodData Central, so saving them
              can take a few seconds.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

async function undoAll(undos: (() => Promise<unknown>)[]) {
  // Newest first, so a check-in restores the values it overwrote.
  for (const undo of [...undos].reverse()) await undo();
}

function Detail({
  proposal: p,
  onChange,
}: {
  proposal: QuickLogProposal;
  onChange: (p: QuickLogProposal) => void;
}) {
  switch (p.kind) {
    case "water":
      return (
        <label className="proposal-amount">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step={50}
            aria-label="Water amount in ml"
            value={p.amountMl || ""}
            onChange={(e) =>
              onChange({ ...p, amountMl: Number(e.target.value) })
            }
          />
          <span className="muted small">ml</span>
        </label>
      );
    case "workout":
      return (
        <p className="small">
          <span className="capitalize">{p.muscles.join(", ")}</span>
          {p.note && <span className="muted"> · {p.note}</span>}
        </p>
      );
    case "meal":
      return (
        <>
          <textarea
            rows={1}
            className="proposal-text"
            aria-label="Meal description"
            maxLength={4000}
            value={p.description}
            onChange={(e) => onChange({ ...p, description: e.target.value })}
          />
          <ul className="meal-items muted small">
            {p.items.map((item, i) => (
              <li key={i}>
                <span>
                  {item.name} · {item.grams} g
                </span>
                {p.items.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      onChange({
                        ...p,
                        items: p.items.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    case "savedMeal": {
      // Quarter steps, as Saved meals logs them.
      const step = (by: number) =>
        onChange({
          ...p,
          servings: Math.min(10, Math.max(0.25, p.servings + by)),
        });
      return (
        <div className="row spaced proposal-servings">
          <span className="small">{p.name}</span>
          <div
            className="serving-picker small-picker"
            role="group"
            aria-label={`Servings of ${p.name}`}
          >
            <button
              type="button"
              className="icon-button"
              aria-label={`A quarter serving less of ${p.name}`}
              disabled={p.servings <= 0.25}
              onClick={() => step(-0.25)}
            >
              <Minus size={16} />
            </button>
            <output>{servingLabel(p.servings)}</output>
            <button
              type="button"
              className="icon-button"
              aria-label={`A quarter serving more of ${p.name}`}
              disabled={p.servings >= 10}
              onClick={() => step(0.25)}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
      );
    }
    case "checkin":
      return <p className="small">{checkinLine(p)}</p>;
  }
}
