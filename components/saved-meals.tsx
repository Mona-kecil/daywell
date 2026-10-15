"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  BookmarkPlus,
  Minus,
  Plus,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SAVED_MEAL_LIMIT, scaleItems } from "@/lib/saved-meals";
import { scaleNutrients, sumNutrients, type Macros } from "@/lib/nutrients";
import { ShoppingBody } from "./shopping";
import { SectionTitle, Sheet, useTask } from "./ui";
import { MakesPicker } from "./makes-picker";
import { ManualBody } from "./meal-add";

type Saved = FunctionReturnType<typeof api.savedMeals.list>[number];

const NAME_MAX = 80;
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const macroLine = (m: Macros) =>
  `${whole(m.kcal)} kcal · P ${whole(m.protein)} · F ${whole(m.fat)} · C ${whole(m.carbs)} g`;
const grams = (n: number) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 1 : 0 })} g`;

const QUARTERS = ["", "¼", "½", "¾"];
// "1½ servings", "¾ serving": eaten amounts move in quarter steps.
export function servingLabel(n: number) {
  const units = Math.floor(n);
  const quarter = QUARTERS[Math.round((n - units) * 4) % 4];
  const amount = units === 0 ? quarter : `${units}${quarter}`;
  return `${amount} ${n <= 1 ? "serving" : "servings"}`;
}

// Short enough to fit beside the log icon at 320 px.
export function savedLine(meal: Pick<Saved, "perServing" | "servings">) {
  const kcal = `${whole(meal.perServing.kcal)} kcal`;
  return meal.servings === 1
    ? `${kcal} · P ${whole(meal.perServing.protein)} g`
    : `${kcal} a serving · makes ${meal.servings}`;
}

export function SavedMeals() {
  const saved = useQuery(api.savedMeals.list, {});
  const [openId, setOpenId] = useState<Id<"savedMeals"> | null>(null);
  const [shopping, setShopping] = useState(false);
  const [creating, setCreating] = useState(false);
  if (saved === undefined) return null;
  const open = saved.find((m) => m.id === openId);
  return (
    <section className="card saved-meals" aria-labelledby="saved-title">
      <SectionTitle
        id="saved-title"
        title="Saved meals"
        detail={
          saved.length
            ? "Tap one to log it now."
            : "Meals you eat often, ready in one tap."
        }
        action={
          saved.length > 0 && (
            <button
              type="button"
              className="soft-button"
              aria-haspopup="dialog"
              onClick={() => setShopping(true)}
            >
              <ShoppingBasket size={16} /> Shopping list
            </button>
          )
        }
      />
      {saved.length ? (
        <ul>
          {saved.map((meal) => (
            <li key={meal.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${meal.name}, ${savedLine(meal)}. Log or edit`}
                onClick={() => setOpenId(meal.id)}
              >
                <span className="recent-name">{meal.name}</span>
                <span className="muted small">{savedLine(meal)}</span>
                <Plus size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small saved-empty">
          <BookmarkPlus size={16} aria-hidden /> Open a logged meal below and
          tap <strong>Save for next time</strong>, or build one here.
        </p>
      )}
      <button
        type="button"
        className="text-button saved-new"
        aria-haspopup="dialog"
        disabled={saved.length >= SAVED_MEAL_LIMIT}
        onClick={() => setCreating(true)}
      >
        <Plus size={16} /> New saved meal
      </button>
      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New saved meal"
      >
        {creating && (
          <ManualBody mode="save" onDone={() => setCreating(false)} />
        )}
      </Sheet>
      <Sheet
        open={shopping}
        onClose={() => setShopping(false)}
        title="Shopping list"
      >
        {shopping && <ShoppingBody recipes={saved} />}
      </Sheet>
      <Sheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open?.name ?? ""}
      >
        {open && (
          <SavedBody key={open.id} meal={open} onDone={() => setOpenId(null)} />
        )}
      </Sheet>
    </section>
  );
}

function SavedBody({ meal, onDone }: { meal: Saved; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <EditSaved meal={meal} onDone={() => setEditing(false)} onGone={onDone} />
  ) : (
    <LogSaved meal={meal} onDone={onDone} onEdit={() => setEditing(true)} />
  );
}

function LogSaved({
  meal,
  onDone,
  onEdit,
}: {
  meal: Saved;
  onDone: () => void;
  onEdit: () => void;
}) {
  const log = useMutation(api.savedMeals.log),
    deleteMeal = useMutation(api.meals.deleteMeal);
  const { run, pending } = useTask();
  const [eaten, setEaten] = useState(1);
  const items = scaleItems(meal.items, eaten, meal.servings);
  const totals = sumNutrients(
    items.map((item) => scaleNutrients(item.per100g, item.grams)),
  );
  const step = (n: number) =>
    setEaten(Math.min(10, Math.max(0.25, Math.round(n * 4) / 4)));
  return (
    <div className="sheet-section saved-log">
      <p className="muted small">
        {meal.servings === 1
          ? "The whole recipe is one serving."
          : `The recipe makes ${meal.servings} servings.`}
      </p>
      <div className="serving-picker" role="group" aria-label="How much">
        <button
          type="button"
          className="icon-button"
          aria-label="A quarter serving less"
          disabled={eaten <= 0.25}
          onClick={() => step(eaten - 0.25)}
        >
          <Minus size={18} />
        </button>
        <output aria-live="polite">{servingLabel(eaten)}</output>
        <button
          type="button"
          className="icon-button"
          aria-label="A quarter serving more"
          disabled={eaten >= 10}
          onClick={() => step(eaten + 0.25)}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="serving-chips" role="group" aria-label="Quick amounts">
        {[0.5, 1, 1.5, 2].map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            aria-label={servingLabel(n)}
            aria-pressed={eaten === n}
            onClick={() => setEaten(n)}
          >
            {servingLabel(n).split(" ")[0]}
          </button>
        ))}
      </div>
      <ul className="saved-foods">
        {items.map((item, i) => (
          <li key={i}>
            <span>{item.name}</span>
            <span className="muted">{grams(item.grams)}</span>
          </li>
        ))}
      </ul>
      <p className="nutrient-line small" aria-live="polite">
        {macroLine(totals)}
      </p>
      <button
        type="button"
        className="primary-button full"
        disabled={pending}
        onClick={() =>
          void run(
            async () => {
              const id = await log({
                id: meal.id,
                at: Date.now(),
                servings: eaten,
              });
              onDone();
              return id;
            },
            `Logged ${meal.name}`,
            (id) => deleteMeal({ id }),
          )
        }
      >
        Log {servingLabel(eaten)}
      </button>
      <button type="button" className="text-button" onClick={onEdit}>
        Edit saved meal
      </button>
    </div>
  );
}

function EditSaved({
  meal,
  onDone,
  onGone,
}: {
  meal: Saved;
  onDone: () => void;
  onGone: () => void;
}) {
  const update = useMutation(api.savedMeals.update),
    remove = useMutation(api.savedMeals.remove);
  const { run, pending } = useTask();
  const [name, setName] = useState(meal.name);
  const [servings, setServings] = useState(meal.servings);
  const [items, setItems] = useState(() =>
    meal.items.map((item, key) => ({
      ...item,
      key,
      draft: String(item.grams),
    })),
  );
  const [confirming, setConfirming] = useState(false);
  const valid =
    name.trim().length > 0 &&
    items.length > 0 &&
    items.every((i) => {
      const g = Number(i.draft);
      return i.draft.trim() !== "" && g > 0 && g <= 10_000;
    });
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    void run(async () => {
      await update({
        id: meal.id,
        name: name.trim(),
        servings,
        items: items.map(({ name, fdcId, per100g, draft }) => ({
          name,
          grams: Number(draft),
          per100g,
          ...(fdcId === undefined ? {} : { fdcId }),
        })),
      });
      onDone();
    }, "Saved meal updated");
  };
  return (
    <form className="sheet-section saved-edit" onSubmit={save}>
      <label htmlFor="saved-name">Name</label>
      <input
        id="saved-name"
        required
        maxLength={NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <MakesPicker id="saved-makes" value={servings} onChange={setServings} />
      <p className="muted small">Amounts are for the whole recipe.</p>
      <ul className="saved-foods editable">
        {items.map((item) => (
          <li key={item.key}>
            <span className="grow">{item.name}</span>
            <label className="unit-input saved-grams">
              <span className="sr-only">{item.name} grams</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={10000}
                step="any"
                required
                value={item.draft}
                onChange={(e) =>
                  setItems((all) =>
                    all.map((x) =>
                      x.key === item.key ? { ...x, draft: e.target.value } : x,
                    ),
                  )
                }
              />
              <span>g</span>
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${item.name}`}
              disabled={items.length === 1}
              onClick={() =>
                setItems((all) => all.filter((x) => x.key !== item.key))
              }
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button className="primary-button full" disabled={pending || !valid}>
        Save changes
      </button>
      <div className="row spaced">
        <button type="button" className="text-button" onClick={onDone}>
          Back
        </button>
        <button
          type="button"
          className="text-button danger"
          disabled={pending}
          onBlur={() => setConfirming(false)}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            void run(async () => {
              await remove({ id: meal.id });
              onGone();
            }, `Deleted ${meal.name}`);
          }}
        >
          {confirming ? "Tap again to delete" : "Delete saved meal"}
        </button>
      </div>
    </form>
  );
}

// Offered on a logged meal: keeps its matched foods for next time.
export function SaveMealButton({
  mealId,
  description,
  matched,
}: {
  mealId: Id<"meals">;
  description: string;
  matched: number;
}) {
  const [open, setOpen] = useState(false);
  if (!matched) return null;
  return (
    <>
      <button
        type="button"
        className="soft-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus size={16} /> Save for next time
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Save this meal">
        {open && (
          <SaveForm
            mealId={mealId}
            description={description}
            onDone={() => setOpen(false)}
          />
        )}
      </Sheet>
    </>
  );
}

function SaveForm({
  mealId,
  description,
  onDone,
}: {
  mealId: Id<"meals">;
  description: string;
  onDone: () => void;
}) {
  const saveFromMeal = useMutation(api.savedMeals.saveFromMeal);
  const { run, pending } = useTask();
  const [name, setName] = useState(() => description.trim().slice(0, NAME_MAX));
  return (
    <form
      className="sheet-section saved-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await saveFromMeal({ mealId, name: name.trim() });
          onDone();
        }, `Saved ${name.trim()}`);
      }}
    >
      <label htmlFor="save-name">Name</label>
      <input
        id="save-name"
        required
        maxLength={NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <p className="muted small">
        Its foods and amounts are kept, so you can log it again in one tap or
        change how many servings it makes.
      </p>
      <button
        className="primary-button full"
        disabled={pending || !name.trim()}
      >
        Save meal
      </button>
    </form>
  );
}
