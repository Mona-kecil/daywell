"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

// Counts transitions into `reached` after first render, so loading a day
// that already met its goal stays quiet.
export function useCrossing(reached: boolean) {
  const [count, setCount] = useState(0);
  const previous = useRef<boolean | null>(null);
  useEffect(() => {
    if (previous.current === false && reached) {
      setCount((n) => n + 1);
      navigator.vibrate?.([18, 40, 28]);
    }
    previous.current = reached;
  }, [reached]);
  return count;
}

const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.17 : 0);
  const distance = 54 + (i % 3) * 18;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    tone: ["water", "protein", "kcal"][i % 3],
    size: 6 + (i % 4) * 2,
    delay: (i % 5) * 18,
  };
});

export function Burst({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="burst" key={count} aria-hidden>
      {PARTICLES.map((p, i) => (
        <i
          key={i}
          className={p.tone}
          style={
            {
              "--x": `${p.x}px`,
              "--y": `${p.y}px`,
              "--size": `${p.size}px`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
