import { groundFood } from "../lib/fdc";
import { scaleNutrients } from "../lib/nutrients";
const item = await groundFood(
  {
    id: "live-rice",
    name: "Cooked white rice",
    grams: 150,
    searchQuery: "rice white cooked",
  },
  "DEMO_KEY",
);
if (item.status !== "matched")
  throw new Error("No usable USDA match for cooked white rice");
console.log(
  JSON.stringify(
    {
      query: "cooked white rice, 150 g",
      ...item,
      macros: scaleNutrients(item.per100g, item.grams),
    },
    null,
    2,
  ),
);
