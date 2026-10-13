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
    // Long-press the home-screen icon to jump straight to a tab.
    shortcuts: [
      { name: "Log water", short_name: "Water", url: "/?tab=water" },
      { name: "Log a meal", short_name: "Meal", url: "/?tab=meals" },
      { name: "Log a workout", short_name: "Workout", url: "/?tab=train" },
      { name: "Insights", url: "/?tab=insights" },
    ].map((s) => ({
      ...s,
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
    })),
  };
}
