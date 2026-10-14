"use client";
import Image from "next/image";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Images, ImageOff } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { MacroSummary } from "./today";
import { Empty, SectionTitle, Sheet, timeLabel } from "./ui";

type Photo = FunctionReturnType<typeof api.meals.photos>["page"][number];

const PAGE = 24;
const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const kcalLabel = (kcal: number) => `${Math.round(kcal).toLocaleString()} kcal`;

// Every analysed meal photo, newest first, as a grid to scroll back through.
export function PhotoWall() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.meals.photos,
    {},
    { initialNumItems: PAGE },
  );
  const [openId, setOpenId] = useState<Photo["id"] | null>(null);
  const open = results.find((p) => p.id === openId);
  if (status === "LoadingFirstPage") return null;
  return (
    <section className="card photo-wall" aria-labelledby="photo-wall-title">
      <SectionTitle
        id="photo-wall-title"
        title="Photo wall"
        detail={
          results.length
            ? "Every meal you've photographed, newest first, with its calories."
            : undefined
        }
        action={
          <span className="icon-tile amber">
            <Images size={22} />
          </span>
        }
      />
      {!results.length ? (
        <Empty>Analysed meal photos will collect here.</Empty>
      ) : (
        <ul className="wall-grid">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={`${p.description || "Meal"}, ${dayLabel(p.at)} ${timeLabel(p.at)}, ${kcalLabel(p.kcal)}`}
                onClick={() => setOpenId(p.id)}
              >
                {p.photoUrl ? (
                  <Image
                    unoptimized
                    src={p.photoUrl}
                    alt=""
                    width={240}
                    height={240}
                    loading="lazy"
                  />
                ) : (
                  <ImageOff className="wall-missing" size={24} aria-hidden />
                )}
                <span className="wall-kcal" aria-hidden>
                  {Math.round(p.kcal).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === "CanLoadMore" && (
        <button
          type="button"
          className="soft-button wall-more"
          onClick={() => loadMore(PAGE)}
        >
          Show older photos
        </button>
      )}
      {status === "LoadingMore" && (
        <p className="muted small wall-more" role="status">
          Loading older photos…
        </p>
      )}
      <Sheet
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.description || "Meal"}
      >
        {open && <PhotoDetail photo={open} />}
      </Sheet>
    </section>
  );
}

function PhotoDetail({ photo }: { photo: Photo }) {
  return (
    <div className="wall-detail">
      <div className="wall-photo">
        {photo.photoUrl ? (
          <Image
            unoptimized
            src={photo.photoUrl}
            alt="Your meal photo"
            width={1280}
            height={960}
          />
        ) : (
          <p className="muted small">
            <ImageOff size={18} aria-hidden /> Photo no longer available
          </p>
        )}
      </div>
      <p className="muted small">
        {dayLabel(photo.at)} · {timeLabel(photo.at)}
      </p>
      <div className="metric">
        <strong>{Math.round(photo.kcal).toLocaleString()}</strong>
        <span> kcal</span>
      </div>
      <MacroSummary totals={photo} />
    </div>
  );
}
