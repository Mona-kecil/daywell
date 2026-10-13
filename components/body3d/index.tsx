"use client";
import dynamic from "next/dynamic";

export type { BodyModelProps, MuscleState } from "./BodyScene";
export { muscleKey, MUSCLE_KEYS, type MuscleKey } from "./anatomy";
export { mix, PALETTE, recoveryHex } from "./palette";
export { useIsDark } from "./useIsDark";

export const BodyModel = dynamic(() => import("./BodyScene"), {
  ssr: false,
  loading: () => <div className="body3d body3d-loading" aria-hidden />,
});
