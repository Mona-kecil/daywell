"use client";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, ListPlus, Settings2, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Exercise } from "./strength";
import { Empty, Sheet, useTask } from "./ui";

export type Routine = FunctionReturnType<typeof api.routines.list>[number];

const sameOrder = (a: { _id: string }[], b: { _id: string }[]) =>
  a.length === b.length && a.every((x, i) => x._id === b[i]._id);

// "Back & biceps" from the first two muscles the exercises work.
export function suggestName(exercises: Exercise[]) {
  const muscles = [...new Set(exercises.flatMap((e) => e.muscles))];
  const name = muscles.slice(0, 2).join(" & ");
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 40);
}

// The sheets below hold their own forms, so render them outside any form.
export function RoutineChips({
  routines,
  activeId,
  onStart,
  onManage,
}: {
  routines: Routine[];
  activeId: Id<"routines"> | null;
  onStart: (routine: Routine) => void;
  onManage: () => void;
}) {
  if (!routines.length) return null;
  return (
    <div className="routines">
      <div className="chip-row" role="group" aria-label="Start a routine">
        {routines.map((r) => (
          <button
            key={r._id}
            type="button"
            className="chip routine-chip"
            aria-pressed={r._id === activeId}
            disabled={!r.exercises.length}
            onClick={() => onStart(r)}
          >
            {r.name}
            <span className="routine-count">{r.exercises.length}</span>
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          aria-label="Manage routines"
          aria-haspopup="dialog"
          onClick={onManage}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </div>
  );
}

export function ManageRoutinesSheet({
  open,
  onClose,
  routines,
}: {
  open: boolean;
  onClose: () => void;
  routines: Routine[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Routines">
      <ManageRoutines routines={routines} />
    </Sheet>
  );
}

function ManageRoutines({ routines }: { routines: Routine[] }) {
  const rename = useMutation(api.routines.rename),
    remove = useMutation(api.routines.remove),
    create = useMutation(api.routines.create);
  const { run, pending } = useTask();
  if (!routines.length) return <Empty>No routines yet.</Empty>;
  return (
    <ul className="entry-list routine-list">
      {routines.map((r) => (
        <li key={r._id}>
          <div>
            <form
              className="routine-rename"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name"));
                if (name.trim() !== r.name)
                  void run(
                    () => rename({ id: r._id, name }),
                    "Routine renamed",
                  );
              }}
            >
              <input
                key={r.name}
                name="name"
                aria-label={`Name of ${r.name}`}
                defaultValue={r.name}
                maxLength={40}
                required
              />
              <button
                className="icon-button"
                disabled={pending}
                aria-label={`Rename ${r.name}`}
              >
                <Check size={18} />
              </button>
            </form>
            <p className="muted small">
              {r.exercises.length
                ? r.exercises.map((e) => e.name).join(" · ")
                : "No exercises left"}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={pending}
            aria-label={`Delete ${r.name}`}
            onClick={() =>
              run(
                () => remove({ id: r._id }),
                `Deleted ${r.name}`,
                // An emptied routine cannot be recreated, so it has no undo.
                r.exercises.length ? (saved) => create(saved) : undefined,
              )
            }
          >
            <Trash2 size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// Offered for a new list, or for a started routine whose list changed.
export function SaveRoutineButton({
  exercises,
  active,
  onClick,
}: {
  exercises: Exercise[];
  active: Routine | null;
  onClick: () => void;
}) {
  if (!exercises.length || (active && sameOrder(active.exercises, exercises)))
    return null;
  return (
    <button
      type="button"
      className="text-button routine-save"
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <ListPlus size={16} />
      {active ? `Save changes to ${active.name}` : "Save as routine"}
    </button>
  );
}

export function SaveRoutineSheet({
  open,
  onClose,
  exercises,
  active,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  active: Routine | null;
  onSaved: (id: Id<"routines">) => void;
}) {
  const create = useMutation(api.routines.create),
    update = useMutation(api.routines.update),
    remove = useMutation(api.routines.remove);
  const { run, pending } = useTask();
  const exerciseIds = exercises.map((e) => e._id);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={active ? "Save routine" : "Save as routine"}
    >
      <ol className="routine-preview">
        {exercises.map((e) => (
          <li key={e._id}>{e.name}</li>
        ))}
      </ol>
      {active && (
        <button
          type="button"
          className="primary-button full"
          disabled={pending}
          onClick={async () => {
            const before = active.exercises.map((e) => e._id);
            if (
              await run(
                async () => {
                  await update({ id: active._id, exerciseIds });
                  onSaved(active._id);
                },
                `Updated ${active.name}`,
                () => update({ id: active._id, exerciseIds: before }),
              )
            )
              onClose();
          }}
        >
          Update {active.name}
        </button>
      )}
      <form
        className="routine-new"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name"));
          if (
            await run(
              async () => {
                const id = await create({ name, exerciseIds });
                onSaved(id);
                return id;
              },
              `Saved ${name.trim()}`,
              (id) => remove({ id }),
            )
          )
            onClose();
        }}
      >
        <label htmlFor="routine-name">
          {active ? "Or save as a new routine" : "Routine name"}
        </label>
        <input
          id="routine-name"
          name="name"
          defaultValue={active ? "" : suggestName(exercises)}
          placeholder="Push day"
          maxLength={40}
          required
        />
        <button
          className={`${active ? "secondary" : "primary"}-button full`}
          disabled={pending}
        >
          Save routine
        </button>
      </form>
    </Sheet>
  );
}
