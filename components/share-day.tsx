"use client";
import { Download, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { dayKey } from "@/lib/insights";
import type { Ring } from "./day-rings";
import { Sheet, useToast } from "./ui";

export type DaySnapshot = {
  now: number;
  rings: Ring[];
  trained: string[];
  meals: number;
};

const W = 1080;
const H = 1350;
const RING_COLOR = {
  water: "--c-fat",
  protein: "--c-protein",
  kcal: "--c-carbs",
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Draws the day as a 4:5 portrait card in the page's current theme.
async function drawDay(day: DaySnapshot) {
  await document.fonts.ready;
  const css = getComputedStyle(document.body);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const display = `${token("--font-display")}, Georgia, serif`;
  const body = `${token("--font-body")}, system-ui, sans-serif`;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = token("--bg");
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = token("--surface");
  roundRect(ctx, 48, 48, W - 96, H - 96, 56);
  ctx.fill();

  const date = new Date(day.now);
  ctx.fillStyle = token("--muted");
  ctx.font = `600 28px ${body}`;
  ctx.letterSpacing = "6px";
  ctx.fillText(
    date.toLocaleDateString([], { weekday: "long" }).toUpperCase(),
    120,
    170,
  );
  ctx.letterSpacing = "0px";
  ctx.fillStyle = token("--text");
  ctx.font = `500 84px ${display}`;
  ctx.fillText(
    date.toLocaleDateString([], { month: "long", day: "numeric" }),
    120,
    262,
  );

  const cx = W / 2;
  const cy = 560;
  const stroke = 46;
  day.rings.forEach((ring, i) => {
    const r = 230 - stroke / 2 - i * (stroke + 14);
    ctx.lineWidth = stroke;
    ctx.lineCap = "round";
    ctx.strokeStyle = token("--track");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const share = Math.min(1, ring.target > 0 ? ring.value / ring.target : 0);
    if (share > 0) {
      ctx.strokeStyle = token(RING_COLOR[ring.id]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
      ctx.stroke();
    }
  });

  day.rings.forEach((ring, i) => {
    const y = 900 + i * 92;
    ctx.fillStyle = token(RING_COLOR[ring.id]);
    ctx.beginPath();
    ctx.arc(138, y - 12, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = token("--muted");
    ctx.font = `500 34px ${body}`;
    ctx.textAlign = "left";
    ctx.fillText(ring.label, 176, y);
    ctx.textAlign = "right";
    const target = ` / ${ring.target.toLocaleString()} ${ring.unit}`;
    ctx.font = `400 32px ${body}`;
    ctx.fillStyle = token("--muted");
    ctx.fillText(target, W - 120, y);
    const offset = ctx.measureText(target).width;
    ctx.font = `600 40px ${body}`;
    ctx.fillStyle = token("--text");
    ctx.fillText(Math.round(ring.value).toLocaleString(), W - 120 - offset, y);
    ctx.textAlign = "left";
  });

  ctx.strokeStyle = token("--border");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, 1150);
  ctx.lineTo(W - 120, 1150);
  ctx.stroke();
  ctx.fillStyle = token("--text");
  ctx.font = `500 32px ${body}`;
  const trained = day.trained.length
    ? `Trained ${day.trained.join(", ")}`
    : "Rest day";
  ctx.fillText(fit(ctx, trained, W - 240), 120, 1212);
  ctx.fillStyle = token("--green");
  ctx.font = `500 30px ${display}`;
  ctx.fillText("Daywell", 120, 1262);
  ctx.fillStyle = token("--muted");
  ctx.font = `400 30px ${body}`;
  ctx.textAlign = "right";
  ctx.fillText(
    `${day.meals} ${day.meals === 1 ? "meal" : "meals"} logged`,
    W - 120,
    1262,
  );

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn’t draw the card.")),
      "image/png",
    ),
  );
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export function ShareDayButton({ day }: { day: DaySnapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Share today as an image"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Share2 size={19} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Share your day">
        <SharePreview day={day} />
      </Sheet>
    </>
  );
}

function SharePreview({ day }: { day: DaySnapshot }) {
  const toast = useToast();
  // Snapshot once per open so the image doesn't redraw every clock tick.
  const [snapshot] = useState(day);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    drawDay(snapshot)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [snapshot]);

  const name = `daywell-${dayKey(new Date(snapshot.now))}.png`;
  const file = image && new File([image.blob], name, { type: "image/png" });
  const canShare = !!file && !!navigator.canShare?.({ files: [file] });
  return (
    <div className="sheet-section share-day">
      <div className="share-preview">
        {image ? (
          // A blob URL can't go through next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt="Today's rings, totals and training" />
        ) : (
          <span className="muted small" role="status">
            {error ?? "Drawing your day…"}
          </span>
        )}
      </div>
      <div className="row form-actions">
        <a
          className="secondary-button"
          href={image?.url}
          download={name}
          aria-disabled={!image}
        >
          <Download size={17} /> Save image
        </a>
        {canShare && (
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              navigator.share({ files: [file], title: "My day" }).catch((e) => {
                if ((e as Error).name !== "AbortError")
                  toast("Sharing failed.");
              })
            }
          >
            <Share2 size={17} /> Share
          </button>
        )}
      </div>
    </div>
  );
}
