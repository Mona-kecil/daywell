"use client";
import { ThemeToggle } from "@/components/tracker";
import { WaterVessel } from "@/components/water-vessel";

export function UiLab() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <strong>UI lab</strong>
        <ThemeToggle />
      </header>
      <main id="main-content">
        <section className="card water-hero">
          <div className="water-hero-body">
            <WaterVessel value={0.62} label="Today's hydration" />
            <div>
              <div className="metric">
                <strong>1,550</strong>
                <span> ml today</span>
              </div>
              <p className="muted small">950 ml to go</p>
              <p className="muted small">62% of 2,500 ml</p>
            </div>
          </div>
        </section>
        <div className="row" style={{ gap: 12 }}>
          {[0, 0.25, 1, 1.4].map((v) => (
            <WaterVessel key={v} value={v} label={`Vessel ${v}`} />
          ))}
        </div>
      </main>
    </div>
  );
}
