"use client";
import { useState } from "react";
import { Droplets, Trash2, SlidersHorizontal } from "lucide-react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Empty, SectionTitle, timeLabel, useTask } from "./ui";
import { WaterVessel } from "./water-vessel";
import { Burst, useCrossing } from "./celebrate";
export function Water({
  entries,
  goal,
}: {
  entries: FunctionReturnType<typeof api.tracker.waterToday>;
  goal: number;
}) {
  const add = useMutation(api.tracker.addWater),
    remove = useMutation(api.tracker.deleteWater),
    setGoal = useMutation(api.tracker.setWaterGoal);
  const [editing, setEditing] = useState(false);
  const { run, pending } = useTask();
  const total = entries.reduce((sum, e) => sum + e.amountMl, 0);
  const celebrations = useCrossing(total >= goal);
  return (
    <>
      <section className="page-heading">
        <div className="eyebrow">HYDRATION</div>
        <h1>Water, through the day.</h1>
        <p className="muted">Log each drink and track your daily goal.</p>
      </section>
      <section className="card water-hero">
        <div className="row spaced">
          <span className="icon-tile blue">
            <Droplets size={24} />
          </span>
          <button
            className="text-button"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
          >
            <SlidersHorizontal size={16} />
            Daily goal
          </button>
        </div>
        <div className="water-hero-body">
          <span className="burst-anchor">
            <WaterVessel value={total / goal} label="Today's hydration" />
            <Burst count={celebrations} />
          </span>
          <div>
            <div className="metric">
              <strong>{total.toLocaleString()}</strong>
              <span> ml today</span>
            </div>
            <p className="muted small">
              {total >= goal
                ? "Daily goal reached."
                : `${Math.max(0, goal - total).toLocaleString()} ml to go`}
            </p>
            <p className="muted small">
              {Math.round((total / goal) * 100)}% of {goal.toLocaleString()} ml
            </p>
          </div>
        </div>
        {editing && (
          <form
            className="inline-form goal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              if (
                await run(
                  () => setGoal({ goal: Number(data.get("goal")) }),
                  "Water goal saved",
                )
              )
                setEditing(false);
            }}
          >
            <label htmlFor="water-goal">Goal (ml)</label>
            <input
              id="water-goal"
              name="goal"
              type="number"
              min="1"
              max="20000"
              defaultValue={goal}
              required
            />
            <button className="soft-button blue" disabled={pending}>
              Save
            </button>
          </form>
        )}
      </section>
      <section className="card">
        <SectionTitle title="Add a drink" />
        <div className="water-buttons">
          {[250, 500].map((amount) => (
            <button
              key={amount}
              className="water-add"
              disabled={pending}
              onClick={() =>
                run(
                  () => add({ amountMl: amount, at: Date.now() }),
                  `Added ${amount} ml`,
                )
              }
            >
              <Droplets size={25} />
              <strong>
                + {amount} <small>ml</small>
              </strong>
              <span className="muted small">
                {amount === 250 ? "A glass" : "A bottle"}
              </span>
            </button>
          ))}
        </div>
        <form
          className="custom-water"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            if (
              await run(
                () =>
                  add({ amountMl: Number(data.get("amount")), at: Date.now() }),
                "Water added",
              )
            )
              form.reset();
          }}
        >
          <label htmlFor="water-amount">Custom amount (ml)</label>
          <div className="row">
            <input
              id="water-amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="1"
              max="10000"
              placeholder="e.g. 350"
              required
            />
            <button className="primary-button" disabled={pending}>
              Add
            </button>
          </div>
        </form>
      </section>
      <section className="card">
        <SectionTitle
          title="Today's drinks"
          detail={`${entries.length} entries`}
        />
        {!entries.length && <Empty>No drinks yet. Add your first glass.</Empty>}
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry._id}>
              <span className="icon-tile blue small-tile">
                <Droplets size={18} />
              </span>
              <div className="grow">
                <strong>{entry.amountMl.toLocaleString()} ml</strong>
                <p className="muted small">{timeLabel(entry.at)}</p>
              </div>
              <button
                className="icon-button"
                disabled={pending}
                aria-label={`Delete ${entry.amountMl} ml entry`}
                onClick={() =>
                  run(() => remove({ id: entry._id }), "Drink deleted")
                }
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
