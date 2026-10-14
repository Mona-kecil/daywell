"use client";
import Image from "next/image";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Camera, Columns2, ImageOff, Images } from "lucide-react";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { dayNumber } from "@/lib/history";
import { dayKey } from "@/lib/insights";
import { downscalePhoto, photoDigest } from "@/lib/photo";
import { Empty, SectionTitle, Sheet, useTask } from "./ui";

type Photo = FunctionReturnType<typeof api.progress.list>[number];
type Pose = Photo["pose"];
const POSES: { id: Pose; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "back", label: "Back" },
];

export const photoDay = (day: string, today: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  });
};
const kg = (n: number) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;

// What changed between two photos, in words.
export function compareLine(a: Photo, b: Photo) {
  const [before, after] = a.day <= b.day ? [a, b] : [b, a];
  const days = dayNumber(after.day) - dayNumber(before.day);
  const span =
    days === 0 ? "the same day" : `${days} day${days === 1 ? "" : "s"}`;
  if (before.weightKg === null || after.weightKg === null)
    return `${days === 0 ? "Taken" : "Over"} ${span}.`;
  const diff = Math.round((after.weightKg - before.weightKg) * 10) / 10;
  const change =
    diff === 0 ? "Same weight" : `${diff > 0 ? "+" : "−"}${kg(Math.abs(diff))}`;
  return `${change} ${days === 0 ? "on" : "over"} ${span}.`;
}

type Draft = { blob: Blob; preview: string; day: string };

// Private body photos by pose, to set side by side over time.
export function ProgressPhotos({ now }: { now: number }) {
  const photos = useQuery(api.progress.list, {});
  const today = dayKey(new Date(now));
  const [pose, setPose] = useState<Pose>("front");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<Photo["id"] | null>(null);
  const [comparing, setComparing] = useState(false);
  const { run, pending } = useTask();
  if (photos === undefined) return null;

  const shown = photos.filter((p) => p.pose === pose);
  const open = photos.find((p) => p.id === openId);
  const label = POSES.find((p) => p.id === pose)!.label.toLowerCase();

  async function choose(file: File) {
    await run(async () => {
      const blob = await downscalePhoto(file);
      // A photo from the library keeps the day it was taken, never later
      // than today.
      const taken = dayKey(new Date(Math.min(file.lastModified, now)));
      setDraft({ blob, preview: URL.createObjectURL(blob), day: taken });
    });
  }

  return (
    <section
      className="card progress-photos"
      aria-labelledby="progress-photos-title"
    >
      <SectionTitle
        id="progress-photos-title"
        title="Progress photos"
        detail={
          photos.length
            ? `${photos.length} photo${photos.length === 1 ? "" : "s"}, only visible to you.`
            : "Private photos of you, to compare over time. Only you can see them."
        }
        action={
          <span className="icon-tile green">
            <Images size={22} />
          </span>
        }
      />
      <div className="segmented" role="group" aria-label="Pose">
        {POSES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={pose === p.id}
            onClick={() => setPose(p.id)}
          >
            {p.label}
            <span className="sr-only">
              , {photos.filter((x) => x.pose === p.id).length} photos
            </span>
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className="progress-grid">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={`${POSES.find((x) => x.id === p.pose)!.label} photo, ${photoDay(p.day, today)}${p.weightKg === null ? "" : `, ${kg(p.weightKg)}`}`}
                onClick={() => setOpenId(p.id)}
              >
                {p.url ? (
                  <Image
                    unoptimized
                    src={p.url}
                    alt=""
                    width={240}
                    height={320}
                    loading="lazy"
                  />
                ) : (
                  <ImageOff size={24} aria-hidden />
                )}
                <span className="progress-tag" aria-hidden>
                  {photoDay(p.day, today)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {photos.length
            ? `No ${label} photos yet.`
            : "Same spot, same light, same time of day works best."}
        </Empty>
      )}
      <div className="progress-actions">
        <label
          className="soft-button progress-add"
          aria-disabled={pending}
          htmlFor="progress-photo"
        >
          <Camera size={18} aria-hidden />
          {pending && !draft ? "Preparing…" : `Add ${label} photo`}
          <input
            id="progress-photo"
            className="file-input"
            type="file"
            accept="image/*"
            disabled={pending}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void choose(file);
            }}
          />
        </label>
        {shown.length >= 2 && (
          <button
            type="button"
            className="soft-button"
            onClick={() => setComparing(true)}
          >
            <Columns2 size={18} aria-hidden />
            Compare
          </button>
        )}
      </div>
      <Sheet
        open={!!draft}
        onClose={() => {
          if (draft) URL.revokeObjectURL(draft.preview);
          setDraft(null);
        }}
        title="New progress photo"
      >
        {draft && (
          <NewPhoto
            draft={draft}
            pose={pose}
            today={today}
            onSaved={(saved) => {
              URL.revokeObjectURL(draft.preview);
              setDraft(null);
              setPose(saved);
            }}
          />
        )}
      </Sheet>
      <Sheet
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open ? photoDay(open.day, today) : ""}
      >
        {open && (
          <PhotoView
            photo={open}
            onDeleted={() => setOpenId(null)}
            key={open.id}
          />
        )}
      </Sheet>
      <Sheet
        open={comparing && shown.length >= 2}
        onClose={() => setComparing(false)}
        title={`Compare ${label}`}
      >
        {comparing && shown.length >= 2 && (
          <Compare photos={shown} today={today} key={pose} />
        )}
      </Sheet>
    </section>
  );
}

function NewPhoto({
  draft,
  pose: initialPose,
  today,
  onSaved,
}: {
  draft: Draft;
  pose: Pose;
  today: string;
  onSaved: (pose: Pose) => void;
}) {
  const getUpload = useMutation(api.progress.uploadUrl);
  const add = useMutation(api.progress.add);
  const { run, pending } = useTask();
  const [pose, setPose] = useState(initialPose);
  const [day, setDay] = useState(draft.day);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today;

  async function save() {
    const ok = await run(async () => {
      const sha256 = await photoDigest(draft.blob);
      const { url, ticketId } = await getUpload({ sha256 });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: draft.blob,
      });
      if (!response.ok)
        throw new Error("Photo upload failed. Please try again.");
      const { storageId } = z
        .object({ storageId: z.string() })
        .parse(await response.json());
      await add({ ticketId, storageId, pose, day, takenAt: Date.now() });
    }, "Photo saved");
    if (ok) onSaved(pose);
  }

  return (
    <div className="progress-new">
      {/* A local blob preview; next/image can't optimise it anyway. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="progress-preview" src={draft.preview} alt="Preview" />
      <div className="segmented" role="group" aria-label="Pose">
        {POSES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={pose === p.id}
            onClick={() => setPose(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="progress-date">
        <span>Taken on</span>
        <input
          type="date"
          value={day}
          max={today}
          required
          onChange={(e) => setDay(e.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        className="primary-button"
        disabled={pending || !valid}
        onClick={() => void save()}
      >
        {pending ? "Saving…" : "Save photo"}
      </button>
    </div>
  );
}

function PhotoView({
  photo,
  onDeleted,
}: {
  photo: Photo;
  onDeleted: () => void;
}) {
  const remove = useMutation(api.progress.remove);
  const { run, pending } = useTask();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="progress-view">
      <figure className="progress-large">
        {photo.url ? (
          <Image
            unoptimized
            src={photo.url}
            alt={`${POSES.find((p) => p.id === photo.pose)!.label} photo`}
            width={600}
            height={800}
          />
        ) : (
          <ImageOff size={32} aria-label="Photo unavailable" />
        )}
        {photo.weightKg !== null && (
          <figcaption>{kg(photo.weightKg)} that day</figcaption>
        )}
      </figure>
      <button
        type="button"
        className="text-button danger"
        disabled={pending}
        onBlur={() => setConfirm(false)}
        onClick={async () => {
          if (!confirm) return setConfirm(true);
          if (await run(() => remove({ id: photo.id }), "Photo deleted"))
            onDeleted();
        }}
      >
        {confirm ? "Tap again to delete" : "Delete photo"}
      </button>
    </div>
  );
}

function Compare({ photos, today }: { photos: Photo[]; today: string }) {
  // Photos arrive newest first.
  const [beforeId, setBeforeId] = useState(photos.at(-1)!.id);
  const [afterId, setAfterId] = useState(photos[0].id);
  const [reveal, setReveal] = useState(50);
  const before = photos.find((p) => p.id === beforeId) ?? photos.at(-1)!;
  const after = photos.find((p) => p.id === afterId) ?? photos[0];
  const option = (p: Photo) => (
    <option key={p.id} value={p.id}>
      {photoDay(p.day, today)}
      {p.weightKg === null ? "" : ` · ${kg(p.weightKg)}`}
    </option>
  );
  // A drag anywhere on the photos moves the divider; iOS range inputs only
  // follow their own thumb.
  const slide = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - box.left) / box.width) * 100;
    setReveal(Math.round(Math.min(100, Math.max(0, at))));
  };
  return (
    <div className="progress-compare">
      <div className="compare-pick">
        <label>
          <span>Before</span>
          <select
            value={before.id}
            onChange={(e) => setBeforeId(e.currentTarget.value as Photo["id"])}
          >
            {photos.map(option)}
          </select>
        </label>
        <label>
          <span>After</span>
          <select
            value={after.id}
            onChange={(e) => setAfterId(e.currentTarget.value as Photo["id"])}
          >
            {photos.map(option)}
          </select>
        </label>
      </div>
      <div
        className="compare-stage"
        style={{ "--reveal": `${reveal}%` } as React.CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          slide(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) slide(e);
        }}
      >
        <ComparePhoto photo={before} which="Before" />
        <ComparePhoto photo={after} which="After" />
        <span className="compare-handle" aria-hidden />
        <input
          className="compare-range"
          type="range"
          min={0}
          max={100}
          value={reveal}
          aria-label="Before and after divider"
          aria-valuetext={`Showing ${100 - reveal}% after`}
          onChange={(e) => setReveal(Number(e.currentTarget.value))}
        />
      </div>
      <p className="compare-line">{compareLine(before, after)}</p>
    </div>
  );
}

function ComparePhoto({
  photo,
  which,
}: {
  photo: Photo;
  which: "Before" | "After";
}) {
  return (
    <div className={`compare-layer ${which.toLowerCase()}`}>
      {photo.url ? (
        <Image
          unoptimized
          src={photo.url}
          alt={`${which} photo`}
          width={600}
          height={800}
        />
      ) : (
        <ImageOff size={32} aria-label={`${which} photo unavailable`} />
      )}
      <span className="compare-tag" aria-hidden>
        {which}
      </span>
    </div>
  );
}
