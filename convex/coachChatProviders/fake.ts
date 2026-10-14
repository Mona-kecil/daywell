import { SPLITS } from "../../lib/forecast";
import type { CoachChatProvider } from "./types";

const list = (names: string[]) =>
  names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const verb = (names: string[], one: string, many: string) =>
  names.length > 1 ? many : one;
const hours = (h: number) =>
  h < 1 ? "under an hour" : `about ${Math.round(h)} h`;

// A deterministic stand-in for a model, grounded only in the snapshot.
export const fake: CoachChatProvider = {
  async answer({ snapshot, messages }) {
    const question = (
      messages.findLast((m) => m.role === "user")?.text ?? ""
    ).toLowerCase();
    const { today, last7Days } = snapshot;
    const waterLeft = Math.max(0, Math.ceil(today.waterGoalMl - today.waterMl));
    const water = waterLeft
      ? `${waterLeft} ml water left today.`
      : "Your water goal is done for today.";
    const split = SPLITS.find((s) => question.includes(s.id));
    const named = snapshot.muscles.filter(
      (m) =>
        question.includes(m.name.toLowerCase()) ||
        (split?.muscles as readonly string[] | undefined)?.includes(m.name),
    );
    const parts: string[] = [];

    if (/week|progress|how am i doing|consisten/.test(question)) {
      parts.push(
        `Over the last 7 days you trained on ${last7Days.trainingDays} ${last7Days.trainingDays === 1 ? "day" : "days"}, drank about ${Math.round(last7Days.avgWaterMl)} ml a day and ate about ${Math.round(last7Days.avgKcal)} kcal a day.`,
        water,
      );
    } else if (
      named.length ||
      /train|workout|gym|lift|muscle|recover|sore|\brest\b/.test(question)
    ) {
      const pool = named.length ? named : snapshot.muscles;
      const ready = pool.filter((m) => m.status === "ready").map((m) => m.name);
      const waiting = pool
        .filter((m) => m.status === "recovering")
        .sort((a, b) => a.hoursUntilReady - b.hoursUntilReady);
      const slowest = waiting.at(-1);
      if (!snapshot.muscles.length)
        parts.push(
          "No muscle recovery data yet. Log a workout and I’ll track each muscle’s cooldown.",
        );
      else if (named.length) {
        if (!slowest)
          parts.push(
            `Yes. ${list(ready)} ${verb(ready, "is", "are")} recovered.`,
          );
        else {
          const names = waiting.map((m) => m.name);
          parts.push(
            `${list(names)} ${verb(names, "needs", "need")} ${hours(slowest.hoursUntilReady)} more.`,
          );
          if (question.includes("tomorrow"))
            parts.push(
              slowest.hoursUntilReady <= 24
                ? "So tomorrow works."
                : "Tomorrow is too soon. Give it another day.",
            );
          if (ready.length)
            parts.push(`${list(ready)} ${verb(ready, "is", "are")} ready now.`);
        }
      } else {
        parts.push(
          ready.length
            ? `Ready now: ${list(ready)}.`
            : "Everything is still recovering.",
        );
        if (waiting[0])
          parts.push(
            `${waiting[0].name} is next, in ${hours(waiting[0].hoursUntilReady)}.`,
          );
        const tip = snapshot.suggestions.find(
          (s) => s.kind === "train" || s.kind === "rest",
        );
        if (tip) parts.push(tip.text);
      }
      parts.push(water);
    } else if (
      /eat|meal|food|protein|dinner|lunch|breakfast|snack|calor|kcal|hungry/.test(
        question,
      )
    ) {
      const { kcal, protein } = today.nutrients;
      const { targets } = today;
      parts.push(
        today.analysedMeals
          ? `So far today: ${Math.round(kcal)} kcal and ${Math.round(protein)} g protein.`
          : "You haven’t logged a meal today yet.",
      );
      if (targets.protein === null)
        parts.push(
          "Build your next meal around chicken, fish, eggs or tofu, with rice and vegetables. Set a protein target to see your remaining grams.",
        );
      else {
        const left = Math.max(0, Math.ceil(targets.protein - protein));
        parts.push(
          left
            ? `${left} g protein left, so build the meal around chicken, fish, eggs or tofu, with rice and vegetables.`
            : "Protein target done. Keep it light with vegetables and a carb you enjoy.",
        );
      }
      if (targets.kcal !== null) {
        const left = Math.round(targets.kcal - kcal);
        parts.push(
          left > 0
            ? `About ${left} kcal left in your target.`
            : `You’re ${-left} kcal over your target, so keep it small.`,
        );
      }
      parts.push(water);
    } else {
      parts.push(
        waterLeft
          ? `${waterLeft} ml water left today, about ${Math.ceil(waterLeft / 250)} ${waterLeft > 250 ? "glasses" : "glass"}. Spread them over the rest of the day.`
          : "Your water goal is done for today. Nice work.",
      );
      const tip = snapshot.suggestions[0];
      if (tip) parts.push(tip.text);
    }
    return parts
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join(" ")
      .slice(0, 600);
  },
};
