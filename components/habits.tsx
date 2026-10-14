"use client";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Flame,
  Heart,
  Leaf,
  ListChecks,
  Moon,
  Pencil,
  PersonStanding,
  Pill,
  Plus,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { HABIT_ICONS, MAX_HABITS, NAME_MAX } from "@/lib/habits";
import { dayKey } from "@/lib/insights";
import { Burst, useCrossing } from "./celebrate";
import { ActionLink, SectionTitle, Sheet, useTask } from "./ui";

type Habit = FunctionReturnType<typeof api.habits.list>[number];
type IconName = (typeof HABIT_ICONS)[number];

export const ICONS: Record<IconName, { Icon: LucideIcon; label: string }> = {
  pill: { Icon: Pill, label: "Pill" },
  stretch: { Icon: PersonStanding, label: "Stretch" },
  book: { Icon: BookOpen, label: "Book" },
  sun: { Icon: Sun, label: "Sun" },
  leaf: { Icon: Leaf, label: "Leaf" },
  heart: { Icon: Heart, label: "Heart" },
  moon: { Icon: Moon, label: "Moon" },
  check: { Icon: Check, label: "Check" },
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
export function streakLabel(h: Pick<Habit, "streak" | "best" | "doneToday">) {
  if (!h.streak) return h.best ? `Best run ${days(h.best)}` : "Not started";
  const run = `${days(h.streak)} in a row`;
  return h.best > h.streak ? `${run} · best ${h.best}` : run;
}

// Small daily things to tick off, with a streak and the last week at a glance.
export function HabitsCard({ now }: { now: number }) {
  const today = dayKey(new Date(now));
  const habits = useQuery(api.habits.list, { today });
  if (habits === undefined) return null;
  return <HabitsBody habits={habits} today={today} />;
}

// Mounted with data, so a day that loads already complete stays quiet.
function HabitsBody({ habits, today }: { habits: Habit[]; today: string }) {
  const toggle = useMutation(api.habits.toggle).withOptimisticUpdate(
    (store, { id, day }) => {
      const list = store.getQuery(api.habits.list, { today: day });
      if (!list) return;
      store.setQuery(
        api.habits.list,
        { today: day },
        list.map((h) => {
          if (h.id !== id) return h;
          const done = !h.doneToday;
          const streak = Math.max(0, h.streak + (done ? 1 : -1));
          return {
            ...h,
            doneToday: done,
            streak,
            best: Math.max(h.best, streak),
            last7: [...h.last7.slice(0, 6), done],
          };
        }),
      );
    },
  );
  const { run } = useTask();
  const [editing, setEditing] = useState(false);
  const done = habits.filter((h) => h.doneToday).length;
  const allDone = !!habits.length && done === habits.length;
  const celebrations = useCrossing(allDone);

  return (
    <section className="card habits-card" aria-labelledby="habits-title">
      <SectionTitle
        id="habits-title"
        title="Daily habits"
        detail={
          !habits.length
            ? "A few small things you want to do every day."
            : allDone
              ? `All ${habits.length} done today.`
              : `${done} of ${habits.length} done today.`
        }
        action={
          habits.length ? (
            <ActionLink onClick={() => setEditing(true)}>Edit</ActionLink>
          ) : (
            <span className="icon-tile green">
              <ListChecks size={22} />
            </span>
          )
        }
      />
      {habits.length ? (
        <ul className="habit-list">
          {habits.map((h) => {
            const { Icon } = ICONS[h.icon];
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className="habit-toggle"
                  aria-pressed={h.doneToday}
                  onClick={() => {
                    if (!h.doneToday) navigator.vibrate?.(15);
                    void run(() => toggle({ id: h.id, day: today }));
                  }}
                >
                  <span className="habit-mark" aria-hidden>
                    {h.doneToday ? (
                      <Check size={20} strokeWidth={3} />
                    ) : (
                      <Icon size={20} />
                    )}
                  </span>
                  <span className="habit-text">
                    <span className="habit-name">{h.name}</span>
                    <span className="habit-streak">
                      {h.streak >= 3 && <Flame size={13} aria-hidden />}
                      {streakLabel(h)}
                    </span>
                  </span>
                </button>
                <WeekDots last7={h.last7} />
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          className="soft-button full"
          onClick={() => setEditing(true)}
        >
          <Plus size={16} aria-hidden /> Add a habit
        </button>
      )}
      <Burst count={celebrations} />
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit habits"
      >
        <HabitEditor habits={habits} />
      </Sheet>
    </section>
  );
}

function WeekDots({ last7 }: { last7: boolean[] }) {
  const count = last7.filter(Boolean).length;
  return (
    <span
      className="habit-week"
      role="img"
      aria-label={`Done ${count} of the last 7 days`}
    >
      {last7.map((on, i) => (
        <i key={i} className={on ? "on" : undefined} />
      ))}
    </span>
  );
}

function HabitEditor({ habits }: { habits: Habit[] }) {
  const create = useMutation(api.habits.create);
  const update = useMutation(api.habits.update);
  const archive = useMutation(api.habits.archive);
  const move = useMutation(api.habits.move);
  const { run, pending } = useTask();
  const [editId, setEditId] = useState<Habit["id"] | null>(null);
  const editingHabit = habits.find((h) => h.id === editId);
  const full = habits.length >= MAX_HABITS && !editingHabit;

  return (
    <>
      {habits.length > 0 && (
        <ul className="habit-edit-list">
          {habits.map((h, i) => {
            const { Icon } = ICONS[h.icon];
            return (
              <li key={h.id}>
                <Icon size={18} aria-hidden />
                <span className="habit-name">{h.name}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${h.name} up`}
                  disabled={pending || i === 0}
                  onClick={() =>
                    void run(() => move({ id: h.id, direction: "up" }))
                  }
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${h.name} down`}
                  disabled={pending || i === habits.length - 1}
                  onClick={() =>
                    void run(() => move({ id: h.id, direction: "down" }))
                  }
                >
                  <ChevronDown size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Edit ${h.name}`}
                  aria-pressed={editId === h.id}
                  onClick={() => setEditId(editId === h.id ? null : h.id)}
                >
                  <Pencil size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <HabitForm
        key={editId ?? "new"}
        habit={editingHabit}
        full={full}
        pending={pending}
        onCancel={() => setEditId(null)}
        onArchive={async (h) => {
          if (await run(() => archive({ id: h.id }), `Archived ${h.name}`))
            setEditId(null);
        }}
        onSave={async (name, icon) => {
          const ok = await run(
            () =>
              editingHabit
                ? update({ id: editingHabit.id, name, icon })
                : create({ name, icon }),
            editingHabit ? "Habit saved" : `Added ${name}`,
          );
          if (ok) setEditId(null);
          return ok;
        }}
      />
      <p className="muted small">
        Archived habits leave the list; their history stays in your export.
      </p>
    </>
  );
}

function HabitForm({
  habit,
  full,
  pending,
  onCancel,
  onArchive,
  onSave,
}: {
  habit?: Habit;
  full: boolean;
  pending: boolean;
  onCancel: () => void;
  onArchive: (habit: Habit) => Promise<void>;
  onSave: (name: string, icon: IconName) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState<IconName>(habit?.icon ?? "check");
  const [archiving, setArchiving] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (name.trim() && (await onSave(name.trim(), icon)) && !habit) setName("");
  };
  return (
    <form className="habit-form" onSubmit={submit}>
      <h3 className="sheet-subhead">
        {habit ? `Edit ${habit.name}` : "New habit"}
      </h3>
      {full ? (
        <p className="muted small">
          You have {MAX_HABITS} habits, the most there can be. Archive one to
          add another.
        </p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`${id}-name`}>
            Habit name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={NAME_MAX}
            placeholder="Take vitamins"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="habit-icons" role="group" aria-label="Icon">
            {HABIT_ICONS.map((key) => {
              const { Icon, label } = ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  className="icon-button"
                  aria-label={label}
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
          <div className="row habit-form-actions">
            {habit && (
              <>
                <button
                  type="button"
                  className="text-button danger"
                  disabled={pending}
                  onBlur={() => setArchiving(false)}
                  onClick={() =>
                    archiving ? void onArchive(habit) : setArchiving(true)
                  }
                >
                  <Archive size={14} aria-hidden />
                  {archiving ? "Tap again to archive" : "Archive"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="submit"
              className="primary-button"
              disabled={pending || !name.trim()}
            >
              {habit ? (
                "Save"
              ) : (
                <>
                  <Plus size={16} aria-hidden /> Add habit
                </>
              )}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
