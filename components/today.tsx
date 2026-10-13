"use client";
import { ArrowRight, Camera, Dumbbell, Droplets, Leaf } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { recovery } from "@/lib/recovery";
import type { Macros } from "@/lib/nutrients";
import { Progress, SectionTitle, ActionLink, useTask } from "./ui";
import type { Tab } from "./tracker";

type Overview = FunctionReturnType<typeof api.tracker.overview>;
export function MacroSummary({ totals }: { totals: Macros }) {
  return (
    <div className="macro-grid">
      {[
        { label: "Protein", value: totals.protein, color: "green" },
        { label: "Carbs", value: totals.carbs, color: "amber" },
        { label: "Fat", value: totals.fat, color: "blue" },
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
  mealCount,
  pendingMeals,
  onTab,
}: {
  now: number;
  overview: Overview;
  waterMl: number;
  totals: Macros;
  mealCount: number;
  pendingMeals: number;
  onTab: (tab: Tab) => void;
}) {
  const addWater = useMutation(api.tracker.addWater);
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
  return (
    <>
      <section className="welcome">
        <div className="eyebrow">YOUR DAILY CHECK-IN</div>
        <h1>
          Your daily
          <br />
          <span>overview.</span>
        </h1>
        <p className="muted">Track your training, hydration, and meals.</p>
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
        <h2>Muscle recovery</h2>
        <p className="muted">
          {trained.length
            ? `${ready} of ${trained.length} trained muscle groups are ready.`
            : "No workouts yet. Start with the muscles you trained."}
        </p>
        <div className="readiness-dots" aria-label="Muscle readiness">
          {overview.muscles.map((m) => (
            <span
              key={m._id}
              className={
                m.lastTrainedAt === null
                  ? "untrained"
                  : recovery(now, m.lastTrainedAt, m.cooldownHours).kind ===
                      "ready"
                    ? "ready"
                    : "resting"
              }
              title={`${m.name}: ${recovery(now, m.lastTrainedAt, m.cooldownHours).label}`}
            />
          ))}
        </div>
        {next && (
          <p className="small capitalize">
            {next.name} ·{" "}
            {recovery(now, next.lastTrainedAt, next.cooldownHours).label}
          </p>
        )}
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
              )
            }
          >
            + 250 ml
          </button>
        </div>
      </section>
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
      <p className="page-foot">
        <Leaf size={14} /> Logs follow the local day on your device.
      </p>
    </>
  );
}
