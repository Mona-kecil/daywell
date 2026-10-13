export const BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

// Greedy per-side loading for a standard bar; whatever cannot be loaded
// with the available plates is reported as the remainder (total, both sides).
export function loadBar(totalKg: number, barKg = BAR_KG) {
  if (totalKg < barKg) return { perSide: [], remainderKg: 0, belowBar: true };
  let side = Math.round(((totalKg - barKg) / 2) * 100) / 100;
  const perSide: number[] = [];
  for (const plate of PLATES_KG)
    while (side + 1e-9 >= plate) {
      perSide.push(plate);
      side = Math.round((side - plate) * 100) / 100;
    }
  return { perSide, remainderKg: side * 2, belowBar: false };
}
