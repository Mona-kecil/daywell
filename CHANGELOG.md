# Changelog

Daywell is a phone-first daily tracker for training, food, water and how you feel.

## Unreleased

### Added

- **Cardio everywhere**: a cardio nudge from the coach for people who do cardio, plus cardio in the weekly review, the week story, the "Your day" timeline and the share card.
- **Monthly recap** on Insights: training, cardio, water, weight and habits for this month or last, with a tap-through story.
- **Readiness** on Today: a 0–100 estimate from last night's sleep, your recent sleep, how you feel, soreness and training load. It never says "Ready to push" while any one factor is weak.
- **Readiness in the coach**: on a low morning (06:00–14:00, nothing trained yet) the coach suggests taking it easy instead of a workout, and "Ask your coach" knows today's score.

### Fixed

- One failing Insights card now shows "Try again" instead of taking down the whole tab.
- This month's recap reads as "so far" through its last day.
- "See habits" on a coach suggestion now scrolls to your habits, and cardio reminders open Train.

## 2026-10-15

### Added

- **Cardio log** on Train: runs, walks, rides, swims, rows and other sessions, with effort, distance and a note.
  - A weekly bar for 150 active minutes (hard minutes count double), minutes per day, and a weekly streak.
  - Pace per sport (/km, /100 m, /500 m, km/h), estimated calories from your latest weigh-in, and personal bests.
- **Weight trend** on Insights: a smoothed line through your weigh-ins, your weekly rate, and a goal weight with an estimated date.
- **Waist** in daily check-ins, with the change since your first measurement.
- **Progress photos** with front, side and back poses and a before-and-after slider.
- **Daily habits**: custom habits with streaks, backfill from the week dots, a 12-week history, and an evening nudge from the coach.
- A guided cool-down stretch session on Train.

### Fixed

- The weight chart no longer crashes when it has no points.
- Photo upload tickets expire on time, and pose buttons are 44 px tall.
- The plate calculator snaps only within float error.

## 2026-10-14

### Added

- **Coach**: daily suggestions at the hours you choose, push reminders, a weekly review, and an "Ask your coach" chat grounded in your day.
- **Strength**: exercise library, sets and PRs, rest timer with a spoken next set, plate calculator, warm-up sets, routines, rep targets from e1RM, and lift trends.
- **Recovery planning**: a 48-hour forecast, a 14-day replay on the 3D body, soreness that extends cooldowns, and a plan for the rest of the week.
- **Food**: barcode lookup, manual meals, log-again, a meal photo wall, the eating window, and a protein-gap suggestion grounded in USDA data.
- **Check-ins and insights**: sleep, weight, mood and energy check-ins, a 13-week consistency calendar, a year in pixels, and which habits go with better mood and energy.
- **Caffeine** on board, with the time you'll be ready for sleep.
- **Quick logging**: one-sentence logging, Apple Shortcuts, home-screen shortcuts, undo on toasts, and offline sync status.
- **Extras**: a share-today image card, a day timeline, a week story, an interval timer, paced breathing, achievements, data export, and a Home Screen install card.

## 2026-10-13

### Added

- First version: muscle training with per-muscle cooldowns on an interactive 3D body, water tracking, and meal photos with editable AI descriptions and calories and macros grounded in USDA FoodData Central.
- Sign-in through WorkOS, an installable PWA, a local dev login, and a demo seed.
