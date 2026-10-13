import fixtures from "./fixtures/fdc-search.json";
import barcodes from "./fixtures/fdc-barcodes.json";
import { barcodeKey } from "./barcode";

export function fixtureBarcode(code: string) {
  return (
    barcodes.cases.find((entry) => barcodeKey(entry.code) === barcodeKey(code))
      ?.response ?? { foods: [] }
  );
}

function words(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
}
export function fixtureSearch(query: string) {
  const tokens = new Set(words(query));
  const match = fixtures.cases.find((entry) =>
    entry.aliases.some((alias) =>
      words(alias).every((word) => tokens.has(word)),
    ),
  );
  return match?.response ?? { foods: [] };
}
