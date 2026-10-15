"use client";
import { Minus, Plus } from "lucide-react";

// How many servings a recipe makes, 1–20.
export function MakesPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="row spaced saved-servings">
      <span id={id}>Makes</span>
      <div
        className="serving-picker small-picker"
        role="group"
        aria-labelledby={id}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="One serving fewer"
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={18} />
        </button>
        <output>
          {value} {value === 1 ? "serving" : "servings"}
        </output>
        <button
          type="button"
          className="icon-button"
          aria-label="One serving more"
          disabled={value >= 20}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
