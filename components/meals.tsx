"use client";
import Image from "next/image";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { z } from "zod";
import {
  Camera,
  Trash2,
  RotateCw,
  Search,
  Utensils,
  LoaderCircle,
  ChevronDown,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { downscalePhoto, photoDigest } from "@/lib/photo";
import {
  mealTotals,
  scaleNutrients,
  type MealItem,
  type Macros,
} from "@/lib/nutrients";
import { AddMealOptions, RecentMeals } from "./meal-add";
import { CloseTheGap } from "./gap";
import { PhotoWall } from "./photo-wall";
import { SaveMealButton, SavedMeals } from "./saved-meals";
import { MacroSummary } from "./today";
import { Empty, SectionTitle, useTask, timeLabel } from "./ui";
type Meal = FunctionReturnType<typeof api.meals.today>[number];
function FoodItem({
  item,
  mealId,
  disabled,
}: {
  item: MealItem;
  mealId: Id<"meals">;
  disabled: boolean;
}) {
  const setGrams = useMutation(api.meals.setGrams),
    remove = useMutation(api.meals.removeItem);
  const research = useAction(api.mealActions.research);
  const [searching, setSearching] = useState(false);
  const { run, pending } = useTask();
  const nutrients =
    item.status === "matched" ? scaleNutrients(item.per100g, item.grams) : null;
  return (
    <div className="food-item">
      <div className="row spaced">
        <h3>{item.name}</h3>
        <button
          className="icon-button"
          aria-label={`Remove ${item.name}`}
          disabled={disabled || pending}
          onClick={() =>
            run(() => remove({ id: mealId, itemId: item.id }), "Food removed")
          }
        >
          <Trash2 size={17} />
        </button>
      </div>
      {item.status === "matched" ? (
        <>
          {item.foodDescription !== item.name && (
            <p className="muted small">{item.foodDescription}</p>
          )}
          {item.fdcId !== undefined ? (
            <a
              className="source-link"
              href={`https://fdc.nal.usda.gov/food-details/${item.fdcId}/nutrients`}
              target="_blank"
              rel="noreferrer"
            >
              USDA · FDC {item.fdcId}
            </a>
          ) : (
            <p className="muted small">Entered by you</p>
          )}
        </>
      ) : (
        <p className="unmatched small">
          Unmatched · not included in totals. Try a more specific search.
        </p>
      )}
      <form
        className="inline-form grams-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(
            () =>
              setGrams({
                id: mealId,
                itemId: item.id,
                grams: Number(data.get("grams")),
              }),
            "Portion saved",
          );
        }}
      >
        <label htmlFor={`grams-${mealId}-${item.id}`}>Grams</label>
        <input
          key={item.grams}
          id={`grams-${mealId}-${item.id}`}
          name="grams"
          type="number"
          inputMode="decimal"
          min="0.1"
          max="10000"
          step="0.1"
          defaultValue={item.grams}
          required
          disabled={disabled}
        />
        <button className="soft-button" disabled={disabled || pending}>
          Save
        </button>
      </form>
      {nutrients && (
        <p className="small nutrient-line">
          {Math.round(nutrients.kcal)} kcal · P {nutrients.protein.toFixed(1)}g
          · C {nutrients.carbs.toFixed(1)}g · F {nutrients.fat.toFixed(1)}g
        </p>
      )}
      <button
        className="text-button"
        disabled={disabled || pending}
        onClick={() => setSearching(!searching)}
        aria-expanded={searching}
      >
        <Search size={15} />
        Change food match
      </button>
      {searching && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            if (
              await run(
                () =>
                  research({
                    id: mealId,
                    itemId: item.id,
                    query: String(data.get("query")),
                  }),
                "Food search finished",
              )
            )
              setSearching(false);
          }}
        >
          <label htmlFor={`query-${mealId}-${item.id}`}>
            USDA search query
          </label>
          <input
            id={`query-${mealId}-${item.id}`}
            name="query"
            defaultValue={item.searchQuery}
            maxLength={200}
            required
            disabled={disabled}
          />
          <button
            className="secondary-button full"
            disabled={disabled || pending}
          >
            {pending ? "Searching…" : "Search USDA"}
          </button>
        </form>
      )}
    </div>
  );
}
// Share of meal energy from each macro, in the validated chart order.
function MacroBar({ totals }: { totals: Macros }) {
  const parts = [
    {
      id: "protein",
      label: "Protein",
      grams: totals.protein,
      kcal: totals.protein * 4,
    },
    { id: "fat", label: "Fat", grams: totals.fat, kcal: totals.fat * 9 },
    {
      id: "carbs",
      label: "Carbs",
      grams: totals.carbs,
      kcal: totals.carbs * 4,
    },
  ];
  const sum = parts.reduce((a, p) => a + p.kcal, 0);
  return (
    <span className="macro-bar-wrap">
      {sum > 0 && (
        <span className="macro-bar" aria-hidden>
          {parts.map(
            (p) =>
              p.kcal > 0 && (
                <i
                  key={p.id}
                  className={`seg ${p.id}`}
                  style={{ flexGrow: p.kcal / sum }}
                />
              ),
          )}
        </span>
      )}
      <span className="macro-bar-legend">
        {parts.map((p) => (
          <span key={p.id}>
            <i className={`swatch ${p.id}`} aria-hidden />
            {p.label}{" "}
            <b>
              {p.grams.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
              g
            </b>
          </span>
        ))}
      </span>
    </span>
  );
}
function MealCard({ meal, now }: { meal: Meal; now: number }) {
  const setDescription = useMutation(api.meals.setDescription),
    remove = useMutation(api.meals.deleteMeal);
  const reanalyze = useAction(api.mealActions.reanalyze);
  const { run, pending } = useTask();
  const analyzing = meal.analysis.status === "analyzing";
  const totals = mealTotals(meal.items);
  // Fresh or unfinished meals open for review; settled ones stay compact.
  const [open, setOpen] = useState(
    () => meal.analysis.status !== "ready" || now - meal.at < 15 * 60_000,
  );
  const detailsId = `meal-details-${meal._id}`;
  return (
    <article className={`card meal-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="meal-summary"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
      >
        {meal.photoUrl && !open && (
          <Image
            unoptimized
            className="meal-thumb"
            src={meal.photoUrl}
            alt=""
            width={152}
            height={152}
            loading="lazy"
          />
        )}
        <span className="meal-summary-text">
          <span className="meal-summary-title">
            {meal.description || "Meal"}
          </span>
          <span className="muted small">
            {timeLabel(meal.at)}
            {meal.analysis.status === "ready" &&
              ` · ${Math.round(totals.kcal).toLocaleString()} kcal`}
          </span>
        </span>
        <ChevronDown className="meal-chevron" size={20} aria-hidden />
      </button>
      {!open && meal.analysis.status === "ready" && (
        <MacroBar totals={totals} />
      )}
      {open && (
        <div id={detailsId} className="meal-details">
          {meal.photoUrl && (
            <div className="meal-photo">
              <Image
                unoptimized
                src={meal.photoUrl}
                alt="Your meal photo"
                width={1280}
                height={960}
                loading="lazy"
              />
            </div>
          )}
          <div className="row spaced">
            <span className="muted small">{timeLabel(meal.at)}</span>
            <span
              className={`pill ${meal.analysis.status === "ready" ? "green" : "amber"}`}
            >
              {meal.analysis.status === "ready"
                ? "Logged"
                : meal.analysis.status === "analyzing"
                  ? "Analyzing"
                  : "Needs a retry"}
            </span>
            <button
              className="icon-button"
              aria-label={
                meal.photoUrl ? "Delete meal and photo" : "Delete meal"
              }
              disabled={pending}
              onClick={() =>
                run(() => remove({ id: meal._id }), "Meal deleted")
              }
            >
              <Trash2 size={18} />
            </button>
          </div>
          {analyzing ? (
            <div className="analysis-state" role="status">
              <LoaderCircle className="spin" size={26} />
              <h3>Putting your meal together…</h3>
              <p className="muted small">
                Identifying foods and looking up USDA nutrients.
              </p>
              {meal.analysis.status === "analyzing" &&
                now - meal.analysis.startedAt > 90_000 &&
                // Re-analysis needs the photo; without one, delete and re-log.
                (meal.photoUrl ? (
                  <button
                    className="secondary-button full"
                    disabled={pending}
                    onClick={() => run(() => reanalyze({ id: meal._id }))}
                  >
                    Restart analysis
                  </button>
                ) : (
                  <p className="muted small">
                    This is taking longer than usual. If it doesn’t finish,
                    delete the meal and log it again.
                  </p>
                ))}
            </div>
          ) : (
            <>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = new FormData(
                    e.currentTarget,
                    e.nativeEvent instanceof SubmitEvent
                      ? e.nativeEvent.submitter
                      : null,
                  );
                  const description = String(data.get("description"));
                  const action = data.get("intent");
                  await run(
                    async () => {
                      await setDescription({ id: meal._id, description });
                      if (action === "reanalyze")
                        await reanalyze({ id: meal._id });
                    },
                    action === "reanalyze"
                      ? "Analysis finished"
                      : "Description saved",
                  );
                }}
              >
                <label htmlFor={`description-${meal._id}`}>
                  Meal description
                </label>
                <textarea
                  id={`description-${meal._id}`}
                  name="description"
                  key={meal.description}
                  defaultValue={meal.description}
                  rows={2}
                  maxLength={4000}
                  placeholder="Describe what is on your plate"
                  required
                />
                {meal.photoUrl && (
                  <p className="muted small">
                    Correct the description, then re-analyze to update the
                    foods.
                  </p>
                )}
                <div className="row">
                  <button
                    className="soft-button"
                    name="intent"
                    value="save"
                    disabled={pending}
                  >
                    Save description
                  </button>
                  {meal.photoUrl && (
                    <button
                      className="soft-button"
                      name="intent"
                      value="reanalyze"
                      disabled={pending}
                    >
                      <RotateCw size={16} />
                      Re-analyze
                    </button>
                  )}
                </div>
              </form>
              {meal.analysis.status === "error" && meal.photoUrl && (
                <div className="meal-error" role="alert">
                  <p>{meal.analysis.message}</p>
                  <button
                    className="secondary-button full"
                    disabled={pending}
                    onClick={() => run(() => reanalyze({ id: meal._id }))}
                  >
                    <RotateCw size={17} />
                    Retry analysis
                  </button>
                </div>
              )}
              <div className="food-list">
                {meal.items.map((item) => (
                  <FoodItem
                    key={item.id}
                    item={item}
                    mealId={meal._id}
                    disabled={pending}
                  />
                ))}
              </div>
              {meal.analysis.status === "ready" && (
                <div className="meal-total">
                  <div className="row spaced">
                    <strong>Meal total</strong>
                    <strong>{Math.round(totals.kcal)} kcal</strong>
                  </div>
                  <MacroSummary totals={totals} />
                  {meal.items.some((item) => item.status === "unmatched") && (
                    <p className="muted small">
                      Totals exclude unmatched foods.
                    </p>
                  )}
                  <SaveMealButton
                    mealId={meal._id}
                    description={meal.description}
                    matched={
                      meal.items.filter((item) => item.status === "matched")
                        .length
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
export function Meals({
  meals,
  totals,
  now,
}: {
  meals: Meal[];
  totals: Macros;
  now: number;
}) {
  const getUpload = useMutation(api.meals.uploadUrl),
    create = useAction(api.mealActions.create);
  const { run, pending } = useTask();
  const [uploadStage, setUploadStage] = useState("");
  async function upload(file: File) {
    await run(async () => {
      setUploadStage("Preparing photo…");
      const blob = await downscalePhoto(file);
      const sha256 = await photoDigest(blob);
      const { url, ticketId } = await getUpload({ sha256 });
      setUploadStage("Uploading photo…");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!response.ok)
        throw new Error("Photo upload failed. Please try again.");
      const { storageId } = z
        .object({ storageId: z.string() })
        .parse(await response.json());
      setUploadStage("Analyzing meal…");
      await create({ ticketId, storageId, at: Date.now() });
    });
    setUploadStage("");
  }
  return (
    <>
      <section className="page-heading">
        <div className="eyebrow">FOOD & NOURISHMENT</div>
        <h1>Meals, from your photos.</h1>
        <p className="muted">
          Add a photo, edit the foods, and track nutrients.
        </p>
      </section>
      <section className="card">
        <SectionTitle
          title="Today's nourishment"
          action={
            <span className="icon-tile amber">
              <Utensils size={22} />
            </span>
          }
        />
        <div className="metric">
          <strong>{Math.round(totals.kcal).toLocaleString()}</strong>
          <span> kcal today</span>
        </div>
        <MacroSummary totals={totals} />
        <p className="muted small">
          Totals include ready meals and matched foods.
        </p>
      </section>
      <CloseTheGap totals={totals} />
      <section className="card capture-card">
        <Camera size={30} strokeWidth={1.5} />
        <h2>What’s on your plate?</h2>
        <p className="muted small">
          Take a photo or choose one from your library.
        </p>
        <label
          className={`primary-button capture-button ${pending ? "disabled" : ""}`}
          htmlFor="meal-photo"
        >
          <Camera size={19} />
          {pending ? uploadStage : "Add meal photo"}
          <input
            id="meal-photo"
            className="file-input"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={pending}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        <p className="small provider-note">
          Photo analysis returns sample foods for now.
          <br />
          Review each food and portion before using the totals.
        </p>
        <AddMealOptions />
      </section>
      <SavedMeals />
      <RecentMeals />
      <section>
        <SectionTitle
          title="Today's meals"
          detail={`${meals.length} ${meals.length === 1 ? "meal" : "meals"}`}
        />
        {!meals.length && (
          <div className="card">
            <Empty>Your next meal starts with a photo.</Empty>
          </div>
        )}
        {meals.map((meal) => (
          <MealCard key={meal._id} meal={meal} now={now} />
        ))}
      </section>
      <PhotoWall />
      <p className="page-foot small">Nutrient data: USDA FoodData Central.</p>
    </>
  );
}
