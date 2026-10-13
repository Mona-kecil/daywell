"use client";
import { Minus, Plus, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";

export type Rest = { endsAt: number; total: number };

const KEY = "daywell.restSeconds";
const DONE_MS = 4000;
let audio: AudioContext | null = null;

export function restSeconds() {
  const saved = Number(localStorage.getItem(KEY));
  return saved >= 15 && saved <= 600 ? saved : 90;
}

// Called from the tap that starts a rest so iOS lets the chime play later.
export function startRest(): Rest {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
  const total = restSeconds() * 1000;
  return { endsAt: Date.now() + total, total };
}

function chime() {
  navigator.vibrate?.([180, 90, 180]);
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.2, t + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.3);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.32);
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function RestTimer({
  rest,
  onChange,
}: {
  rest: Rest | null;
  onChange: (rest: Rest | null) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!rest) return;
    // Adjusting is only possible before the end, so a changed rest is unrung.
    let rang = false;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!rang && t >= rest.endsAt) {
        rang = true;
        chime();
      }
      if (t >= rest.endsAt + DONE_MS) onChange(null);
    }, 200);
    return () => clearInterval(id);
  }, [rest, onChange]);
  if (!rest) return null;
  const left = rest.endsAt - now;
  const done = left <= 0;
  const fraction = Math.min(1, Math.max(0, left / rest.total));
  const adjust = (seconds: number) => {
    const total = Math.min(
      600_000,
      Math.max(15_000, rest.total + seconds * 1000),
    );
    localStorage.setItem(KEY, String(total / 1000));
    // Shortening past the end finishes now, so "Go!" still shows and chimes.
    onChange({
      endsAt: Math.max(Date.now(), rest.endsAt + (total - rest.total)),
      total,
    });
  };
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <div className={`rest-timer${done ? " done" : ""}`} role="timer">
      <svg viewBox="0 0 36 36" aria-hidden className="rest-ring">
        <circle cx="18" cy="18" r={R} className="rest-track" />
        <circle
          cx="18"
          cy="18"
          r={R}
          className="rest-arc"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
        />
      </svg>
      <span className="rest-time">
        {done ? (
          <>
            <Timer size={15} /> Go!
          </>
        ) : (
          clock(left)
        )}
      </span>
      <span className="sr-only" aria-live="assertive">
        {done ? "Rest over. Next set." : ""}
      </span>
      {!done && (
        <>
          <button
            type="button"
            aria-label="15 seconds less"
            disabled={rest.total <= 15_000}
            onClick={() => adjust(-15)}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label="15 seconds more"
            disabled={rest.total >= 600_000}
            onClick={() => adjust(15)}
          >
            <Plus size={16} />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Stop rest timer"
        onClick={() => onChange(null)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
