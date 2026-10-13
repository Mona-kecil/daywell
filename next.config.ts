import type { NextConfig } from "next";
// The dev badge sits over the bottom tab bar on phone-sized viewports.
const config: NextConfig = { agentRules: false, devIndicators: false };
export default config;
