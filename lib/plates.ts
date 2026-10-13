export const BAR_KG = 20;
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

// Greedy per-side loading for a standard bar; whatever cannot be loaded
// with the available plates is reported as the remainder (total, both sides).
export function loadBar(totalKg: number, barKg = BAR_KG) {
  if (totalKg < barKg) return { perSide: [], remainderKg: 0, belowBar: true };
  // Grams keep 1.25 kg plates exact: 141.25 kg puts 60.625 kg on each side.
  let side = Math.round(((totalKg - barKg) / 2) * 1000);
  const perSide: number[] = [];
  for (const plate of PLATES_KG)
    while (side >= plate * 1000) {
      perSide.push(plate);
      side -= plate * 1000;
    }
  return { perSide, remainderKg: (side * 2) / 1000, belowBar: false };
}
