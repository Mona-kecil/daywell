"use client";
import { useMutation, useQuery } from "convex/react";
import { CircleCheck, Plus, Target } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { closeGap, type GapSuggestion } from "@/lib/gap";
import type { Macros } from "@/lib/nutrients";
import { SectionTitle, useTask } from "./ui";

const g = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Suggests one lean food portion that closes today's protein target within
// the calories left, from USDA FoodData Central values.
export function CloseTheGap({ totals }: { totals: Macros }) {
  const settings = useQuery(api.coach.settings, {});
  const addManual = useMutation(api.meals.addManual),
    deleteMeal = useMutation(api.meals.deleteMeal),
    setTargets = useMutation(api.coach.setTargets);
  const { run, pending } = useTask();
  const [preview, setPreview] = useState(0);
  if (!settings) return null;
  const target = settings.proteinTarget;
  const plan = closeGap({
    eaten: totals,
    proteinTarget: target,
    kcalTarget: settings.kcalTarget,
  });
  if (!target) {
    // Keep the calorie target: setTargets writes both fields.
    const kcalTarget = settings.kcalTarget ?? undefined;
    return (
      <section className="card gap-card" aria-labelledby="gap-title">
        <SectionTitle
          id="gap-title"
          title="Close the gap"
          detail="Set a daily protein target to see which food closes it."
          action={
            <span className="icon-tile green">
              <Target size={22} />
            </span>
          }
        />
        <form
          className="gap-target"
          onSubmit={(e) => {
            e.preventDefault();
            const protein = Number(
              new FormData(e.currentTarget).get("protein"),
            );
            void run(
              () => setTargets({ kcalTarget, proteinTarget: protein }),
              "Protein target set",
              () => setTargets({ kcalTarget }),
            );
          }}
        >
          <label htmlFor="gap-protein">Daily protein</label>
          <span className="unit-input">
            <input
              id="gap-protein"
              name="protein"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              placeholder="120"
              required
            />
            <span>g</span>
          </span>
          <button className="primary-button" disabled={pending}>
            Set target
          </button>
        </form>
      </section>
    );
  }
  if (plan.status === "no_target") return null;
  if (plan.status === "met")
    return (
      <section className="card gap-card met">
        <p className="gap-met">
          <CircleCheck size={20} aria-hidden />
          <span>
            <strong>Protein target reached.</strong>{" "}
            <span className="muted">
              {g(totals.protein)} of {g(target)} g today.
            </span>
          </span>
        </p>
      </section>
    );

  const kcalNote =
    plan.kcalLeft === null
      ? ""
      : plan.kcalLeft > 0
        ? ` · ${g(plan.kcalLeft)} kcal left`
        : " · calorie target reached";
  const suggestions = plan.status === "open" ? plan.suggestions : [];
  const shown: GapSuggestion | undefined =
    suggestions[Math.min(preview, suggestions.length - 1)];
  const eatenPct = Math.min(100, (totals.protein / target) * 100);
  const addPct = shown
    ? Math.min(100 - eatenPct, (shown.adds.protein / target) * 100)
    : 0;
  const after = shown ? totals.protein + shown.adds.protein : totals.protein;

  const log = (s: GapSuggestion) =>
    run(
      () =>
        addManual({
          at: Date.now(),
          description: s.food.name,
          items: [
            {
              name: s.food.name,
              grams: s.grams,
              fdcId: s.food.fdcId,
              per100g: s.food.per100g,
            },
          ],
        }),
      `Logged ${s.food.name} · ${s.label}`,
      (id) => deleteMeal({ id }),
    );

  return (
    <section className="card gap-card" aria-labelledby="gap-title">
      <SectionTitle
        id="gap-title"
        title="Close the gap"
        detail={`${g(plan.proteinLeft)} g protein to go${kcalNote}`}
        action={
          <span className="icon-tile green">
            <Target size={22} />
          </span>
        }
      />
      <div
        className="gap-bar"
        role="img"
        aria-label={
          shown
            ? `Protein ${g(totals.protein)} of ${g(target)} g. ${shown.food.name} would bring it to ${g(after)} g.`
            : `Protein ${g(totals.protein)} of ${g(target)} g.`
        }
      >
        <span className="gap-eaten" style={{ width: `${eatenPct}%` }} />
        {shown && (
          <span
            className="gap-add"
            style={{ left: `${eatenPct}%`, width: `${addPct}%` }}
          />
        )}
      </div>
      <div className="gap-scale small muted" aria-hidden>
        <span>{g(totals.protein)} g</span>
        {shown && <span className="gap-after">→ {g(after)} g</span>}
        <span>{g(target)} g</span>
      </div>
      {plan.status === "no_room" ? (
        <p className="small muted gap-empty">
          {plan.kcalLeft > 0
            ? `None of the lean options fit in ${g(plan.kcalLeft)} kcal.`
            : "You’re at your calorie target, so there’s nothing to add today."}
        </p>
      ) : (
        <ul className="gap-list">
          {suggestions.map((s, i) => (
            <li
              key={s.food.fdcId}
              className={i === preview ? "previewed" : ""}
              onPointerEnter={() => setPreview(i)}
              onFocus={() => setPreview(i)}
            >
              <div>
                <strong>{s.food.name}</strong>
                <span className="small muted">
                  {s.label} · +{g(s.adds.protein)} g protein · {g(s.adds.kcal)}{" "}
                  kcal
                </span>
                {s.closes ? (
                  <span className="gap-tag closes">Closes the gap</span>
                ) : (
                  <span className="gap-tag">
                    {Math.ceil(plan.proteinLeft - s.adds.protein)} g short
                  </span>
                )}
              </div>
              <button
                type="button"
                className="soft-button"
                disabled={pending}
                aria-label={`Log ${s.food.name}, ${s.label}`}
                onClick={() => void log(s)}
              >
                <Plus size={16} /> Log
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
