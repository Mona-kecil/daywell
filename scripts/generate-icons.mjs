import sharp from "sharp";
import { readFile } from "node:fs/promises";
const svg = await readFile(
  new URL("../public/icons/mark.svg", import.meta.url),
);
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
  ["apple-touch-icon", 180],
]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icons/${name}.png`, import.meta.url).pathname);
}
