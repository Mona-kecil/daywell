"use client";
import { useState } from "react";
import { Check, Minus, Plus, Share2 } from "lucide-react";
import {
  amount,
  prunePlan,
  shoppingList,
  shoppingText,
  type Plan,
} from "@/lib/shopping";
import type { SavedMealItem } from "@/lib/saved-meals";
import { useTask } from "./ui";

export const SHOPPING_KEY = "daywell.shopping";

type Recipe = {
  id: string;
  name: string;
  servings: number;
  items: SavedMealItem[];
};
type Stored = { plan: Plan; checked: string[] };

function load(ids: string[]): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOPPING_KEY) ?? "null");
    return {
      plan: prunePlan(raw?.plan ?? {}, ids),
      checked: Array.isArray(raw?.checked)
        ? raw.checked.filter((k: unknown) => typeof k === "string")
        : [],
    };
  } catch {
    return { plan: {}, checked: [] };
  }
}

// Plan servings of saved meals; the foods add up into one list to tick off.
export function ShoppingBody({ recipes }: { recipes: Recipe[] }) {
  const { run } = useTask();
  const [stored, setStored] = useState(() => load(recipes.map((r) => r.id)));
  const list = shoppingList(recipes, stored.plan);
  const checked = stored.checked.filter((k) => list.some((l) => l.key === k));
  const update = (next: Stored) => {
    setStored(next);
    localStorage.setItem(SHOPPING_KEY, JSON.stringify(next));
  };
  const plan = (id: string, n: number) => {
    const next = { ...stored.plan, [id]: n };
    if (n <= 0) delete next[id];
    update({ ...stored, plan: next });
  };
  const toggle = (key: string) =>
    update({
      ...stored,
      checked: checked.includes(key)
        ? checked.filter((k) => k !== key)
        : [...checked, key],
    });
  const left = list.length - checked.length;
  // Which meal needs a food only matters once you plan more than one.
  const several = Object.keys(stored.plan).length > 1;
  const share = () => {
    const text = shoppingText(list, checked);
    const canShare = typeof navigator.share === "function";
    void run(
      async () => {
        if (canShare) {
          try {
            await navigator.share({ title: "Shopping list", text });
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            throw error;
          }
        } else await navigator.clipboard.writeText(text);
      },
      canShare ? undefined : "List copied",
    );
  };
  return (
    <div className="sheet-section shopping">
      <h3 id="shop-plan">Meals to make</h3>
      <ul className="shop-plan" aria-labelledby="shop-plan">
        {recipes.map((r) => {
          const n = stored.plan[r.id] ?? 0;
          return (
            <li key={r.id}>
              <span className="shop-meal">
                <span>{r.name}</span>
                <span className="muted small">
                  {r.servings === 1
                    ? "1 serving per recipe"
                    : `${r.servings} servings per recipe`}
                </span>
              </span>
              <span className="shop-count" role="group" aria-label={r.name}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`One serving fewer of ${r.name}`}
                  disabled={n <= 0}
                  onClick={() => plan(r.id, n - 1)}
                >
                  <Minus size={16} />
                </button>
                <output aria-label={`${r.name} servings`}>{n}</output>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`One serving more of ${r.name}`}
                  disabled={n >= 50}
                  onClick={() => plan(r.id, n + 1)}
                >
                  <Plus size={16} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <h3 id="shop-buy">
        To buy
        {list.length > 0 && (
          <span className="muted small">
            {" "}
            · {left ? `${left} left` : "all done"}
          </span>
        )}
      </h3>
      {list.length ? (
        <ul className="shop-list" aria-labelledby="shop-buy">
          {list.map((line) => {
            const done = checked.includes(line.key);
            return (
              <li key={line.key}>
                <label className={done ? "done" : undefined}>
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => toggle(line.key)}
                  />
                  <span className="shop-box" aria-hidden>
                    {done && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className="shop-name">
                    {line.name}
                    {several && (
                      <span className="muted small">
                        {" "}
                        for {line.meals.join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="shop-amount">{amount(line.grams)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">
          Add servings above and their foods add up here.
        </p>
      )}
      {list.length > 0 && (
        <div className="shop-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!left}
            onClick={share}
          >
            <Share2 size={17} /> Share list
          </button>
          <button
            type="button"
            className="soft-button"
            onClick={() => update({ plan: {}, checked: [] })}
          >
            Start over
          </button>
        </div>
      )}
      <p className="muted small">
        Amounts come from your saved meals, so cooked foods show their cooked
        weight. They’re rounded up, and the list stays on this device.
      </p>
    </div>
  );
}
