"use client";
import { ArrowRight, Camera, Dumbbell, Droplets, Leaf } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { recovery } from "@/lib/recovery";
import type { Macros } from "@/lib/nutrients";
import { Progress, SectionTitle, ActionLink, useTask } from "./ui";
import { InstallCard } from "./install";
import type { Tab } from "./tracker";
import { BodyModel, muscleKey } from "./body3d";
import { DayRings, type Ring } from "./day-rings";
import { ShareDayButton } from "./share-day";
import { dayKey } from "@/lib/insights";
import { Burst, useCrossing } from "./celebrate";
import { CoachCard } from "./coach";
import { QuickLogButton } from "./quick-log";
import { CheckInCard } from "./checkin";
import { CaffeineCard } from "./caffeine";
import { DayTimeline } from "./timeline";
import type { Doc } from "@/convex/_generated/dataModel";

// Ring targets when the user hasn't set their own in Settings.
const PROTEIN_TARGET_G = 120;
const KCAL_TARGET = 2200;

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 5) return ["Still up?", "Rest counts too."];
  if (hour < 12) return ["Good", "morning."];
  if (hour < 18) return ["Good", "afternoon."];
  return ["Good", "evening."];
}

type Overview = FunctionReturnType<typeof api.tracker.overview>;
export function MacroSummary({ totals }: { totals: Macros }) {
  return (
    <div className="macro-grid">
      {[
        { label: "Protein", value: totals.protein, color: "protein" },
        { label: "Fat", value: totals.fat, color: "fat" },
        { label: "Carbs", value: totals.carbs, color: "carbs" },
      ].map((m) => (
        <div key={m.label}>
          <span className={`macro-dot ${m.color}`} />
          <span className="muted small">{m.label}</span>
          <strong>
            {m.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            <small> g</small>
          </strong>
        </div>
      ))}
    </div>
  );
}
export function Today({
  now,
  overview,
  waterMl,
  totals,
  targets,
  mealCount,
  pendingMeals,
  water,
  meals,
  onTab,
}: {
  now: number;
  overview: Overview;
  waterMl: number;
  totals: Macros;
  targets?: { kcalTarget: number | null; proteinTarget: number | null };
  mealCount: number;
  pendingMeals: number;
  water: Doc<"water">[];
  meals: FunctionReturnType<typeof api.meals.today>;
  onTab: (tab: Tab) => void;
}) {
  const addWater = useMutation(api.tracker.addWater),
    deleteWater = useMutation(api.tracker.deleteWater);
  const { run, pending } = useTask();
  const trained = overview.muscles.filter((m) => m.lastTrainedAt !== null);
  const recovering = trained.filter(
    (m) =>
      recovery(now, m.lastTrainedAt, m.cooldownHours).kind === "recovering",
  );
  const ready = trained.length - recovering.length;
  const next = [...recovering].sort(
    (a, b) =>
      (a.lastTrainedAt ?? 0) +
      a.cooldownHours * 3_600_000 -
      ((b.lastTrainedAt ?? 0) + b.cooldownHours * 3_600_000),
  )[0];
  const states = Object.fromEntries(
    overview.muscles.flatMap((m) => {
      const key = muscleKey(m.name);
      return key
        ? [[key, recovery(now, m.lastTrainedAt, m.cooldownHours)] as const]
        : [];
    }),
  );
  const [lead, accent] = greeting(now);
  const celebrations = useCrossing(waterMl >= overview.waterGoal);
  const rings: Ring[] = [
    {
      id: "water",
      label: "Water",
      value: waterMl,
      target: overview.waterGoal,
      unit: "ml",
    },
    {
      id: "protein",
      label: "Protein",
      value: totals.protein,
      target: targets?.proteinTarget ?? PROTEIN_TARGET_G,
      unit: "g",
    },
    {
      id: "kcal",
      label: "Calories",
      value: totals.kcal,
      target: targets?.kcalTarget ?? KCAL_TARGET,
      unit: "kcal",
    },
  ];
  return (
    <>
      <section className="welcome">
        <div className="eyebrow">YOUR DAILY CHECK-IN</div>
        <h1>
          {lead}
          <br />
          <span>{accent}</span>
        </h1>
      </section>
      <QuickLogButton />
      <CoachCard now={now} onTab={onTab} />
      <section className="card burst-anchor rings-card">
        <SectionTitle
          title="Today so far"
          action={
            <ShareDayButton
              day={{
                now,
                rings,
                meals: mealCount,
                trained: overview.muscles
                  .filter(
                    (m) =>
                      m.lastTrainedAt !== null &&
                      dayKey(new Date(m.lastTrainedAt)) ===
                        dayKey(new Date(now)),
                  )
                  .map((m) => m.name),
              }}
            />
          }
        />
        <Burst count={celebrations} />
        <DayRings rings={rings} />
      </section>
      <section className="card recovery-card">
        <div className="card-top">
          <span className="icon-tile green">
            <Dumbbell size={23} />
          </span>
          <span className="pill green">
            {recovering.length ? "Recovery in progress" : "Room to move"}
          </span>
        </div>
        <div className="recovery-body">
          <button
            type="button"
            className="recovery-figure"
            aria-label="Open muscle recovery"
            onClick={() => onTab("train")}
          >
            <BodyModel states={states} height={210} compact />
          </button>
          <div>
            <h2>Muscle recovery</h2>
            <p className="muted">
              {trained.length
                ? `${ready} of ${trained.length} trained muscle groups are ready.`
                : "No workouts yet. Start with the muscles you trained."}
            </p>
            {next && (
              <p className="small capitalize">
                <strong>{next.name}</strong>
                <br />
                <span className="muted">
                  {recovery(now, next.lastTrainedAt, next.cooldownHours).label}
                </span>
              </p>
            )}
          </div>
        </div>
        <button className="card-link" onClick={() => onTab("train")}>
          See muscle recovery <ArrowRight size={18} />
        </button>
      </section>
      <section className="card">
        <SectionTitle
          title="Today's water"
          action={
            <span className="icon-tile blue">
              <Droplets size={23} />
            </span>
          }
        />
        <div className="metric">
          <strong>{waterMl.toLocaleString()}</strong>
          <span> / {overview.waterGoal.toLocaleString()} ml</span>
        </div>
        <Progress
          value={waterMl / overview.waterGoal}
          label="Today's water goal"
          tone="blue"
        />
        <div className="row spaced">
          <span className="muted small">
            {Math.max(0, overview.waterGoal - waterMl).toLocaleString()} ml to
            your goal
          </span>
          <button
            className="soft-button blue"
            disabled={pending}
            onClick={() =>
              run(
                () => addWater({ amountMl: 250, at: Date.now() }),
                "Added 250 ml",
                (id) => deleteWater({ id }),
              )
            }
          >
            + 250 ml
          </button>
        </div>
      </section>
      <CaffeineCard />
      <section className="card">
        <SectionTitle
          title="Today's meals"
          action={<ActionLink onClick={() => onTab("meals")}>Meals</ActionLink>}
        />
        <div className="metric">
          <strong>{Math.round(totals.kcal).toLocaleString()}</strong>
          <span> kcal today</span>
        </div>
        <MacroSummary totals={totals} />
        <p className="muted small">
          {mealCount} {mealCount === 1 ? "meal" : "meals"} logged
          {pendingMeals > 0 ? ` · ${pendingMeals} awaiting analysis` : ""}
        </p>
      </section>
      <CheckInCard now={now} />
      <DayTimeline
        now={now}
        water={water}
        meals={meals}
        muscles={overview.muscles}
      />
      <section>
        <SectionTitle title="Quick actions" />
        <div className="quick-actions">
          <button onClick={() => onTab("train")}>
            <Dumbbell />
            <span>Log workout</span>
          </button>
          <button onClick={() => onTab("water")}>
            <Droplets />
            <span>Add water</span>
          </button>
          <button onClick={() => onTab("meals")}>
            <Camera />
            <span>Log a meal</span>
          </button>
        </div>
      </section>
      <InstallCard />
      <p className="page-foot">
        <Leaf size={14} /> Logs follow the local day on your device.
      </p>
    </>
  );
}
