import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Daywell — daily life tracker",
    short_name: "Daywell",
    description: "Your muscle recovery, water, and meals in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#285648",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
