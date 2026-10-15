import { parseQuickLog } from "../../lib/quick-log";
import type { QuickLogProvider } from "./types";

export const fake: QuickLogProvider = {
  async parse(input) {
    const result = parseQuickLog(input.text, {
      now: input.now,
      timeZone: input.timeZone,
      savedMeals: input.savedMeals?.map((name) => ({ id: name, name })),
      muscles: input.muscles.map((name) => ({ id: name, name })),
    });
    return {
      ...result,
      proposals: result.proposals.map((proposal) => {
        if (proposal.kind === "savedMeal")
          return {
            kind: proposal.kind,
            name: proposal.name,
            servings: proposal.servings,
            at: proposal.at,
          };
        if (proposal.kind !== "workout") return proposal;
        return {
          kind: proposal.kind,
          muscles: proposal.muscles,
          at: proposal.at,
          note: proposal.note,
        };
      }),
    };
  },
};
