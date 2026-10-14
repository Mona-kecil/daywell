"use client";
import { useState } from "react";
import { BAR_KG } from "@/lib/plates";
import { LOAD_STEP_KG, repTable } from "@/lib/rep-max";
import { Plates, kg } from "./strength";

// Working weights for each rep count from an estimated one-rep max, with the
// plates for the row you pick.
export function RepTargets({
  bestKg,
  lastKg,
}: {
  bestKg: number;
  lastKg: number;
}) {
  const [basis, setBasis] = useState<"last" | "best">("last");
  const [picked, setPicked] = useState(5);
  // Only offer a choice when last session's estimate shows differently.
  const both = lastKg > 0 && kg(lastKg) !== kg(bestKg);
  const fromLast = both && basis === "last";
  const max = fromLast ? lastKg : bestKg;
  const rows = repTable(max);
  const row = rows.find((r) => r.reps === picked) ?? rows[0];
  if (!row) return null;
  return (
    <section className="rep-targets" aria-labelledby="rep-targets-title">
      <div className="row spaced">
        <h3 id="rep-targets-title" className="sheet-subhead">
          Rep targets
        </h3>
        {both && (
          <div
            className="segmented rep-basis"
            role="group"
            aria-label="Based on"
          >
            <button
              type="button"
              aria-pressed={fromLast}
              onClick={() => setBasis("last")}
            >
              Last session
            </button>
            <button
              type="button"
              aria-pressed={!fromLast}
              onClick={() => setBasis("best")}
            >
              Best
            </button>
          </div>
        )}
      </div>
      <p className="muted small">
        From {fromLast ? "last session’s" : "your best"} e1RM of {kg(max)} kg.
        Pick a row for its plates.
      </p>
      <ol className="rep-rows">
        {rows.map((r) => (
          <li key={r.reps}>
            <button
              type="button"
              aria-pressed={r === row}
              onClick={() => setPicked(r.reps)}
            >
              <span className="rep-count">
                <strong>{r.reps}</strong> {r.reps === 1 ? "rep" : "reps"}
              </span>
              <span className="rep-bar" aria-hidden>
                <span style={{ width: `${r.percent}%` }} />
              </span>
              <span className="rep-pct small">{r.percent}%</span>
              <strong className="rep-kg">{kg(r.weightKg)} kg</strong>
            </button>
          </li>
        ))}
      </ol>
      <div aria-live="polite">
        {row.weightKg >= BAR_KG ? (
          <Plates totalKg={row.weightKg} />
        ) : (
          <p className="muted small">
            {kg(row.weightKg)} kg is lighter than a {BAR_KG} kg bar; use
            dumbbells or a lighter bar.
          </p>
        )}
      </div>
      <p className="muted small">
        Rounded down to {kg(LOAD_STEP_KG)} kg. Estimates get looser past 10
        reps.
      </p>
    </section>
  );
}
