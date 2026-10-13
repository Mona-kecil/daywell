import { Euler, Quaternion, Vector3 } from "three";

export const MUSCLE_KEYS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
] as const;
export type MuscleKey = (typeof MUSCLE_KEYS)[number];

export function muscleKey(name: string): MuscleKey | null {
  const key = name.trim().toLowerCase();
  return (MUSCLE_KEYS as readonly string[]).includes(key)
    ? (key as MuscleKey)
    : null;
}

type Vec3 = readonly [number, number, number];
export type Ellipsoid = {
  kind: "ellipsoid";
  position: Vec3;
  scale: Vec3;
  rotation: Vec3;
};
export type Capsule = {
  kind: "capsule";
  position: Vec3;
  rotation: Vec3;
  radius: number;
  length: number;
};
export type RoundedBox = {
  kind: "box";
  position: Vec3;
  size: Vec3;
  rotation: Vec3;
};
export type Shape = Ellipsoid | Capsule | RoundedBox;

const UP = new Vector3(0, 1, 0);
const tuple = (v: Vector3 | Euler): Vec3 => [v.x, v.y, v.z];

function alignTo(a: Vec3, b: Vec3) {
  const dir = new Vector3(...b).sub(new Vector3(...a));
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  return { length, rotation: tuple(new Euler().setFromQuaternion(q)) };
}

function ellipsoid(position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]) {
  return { kind: "ellipsoid", position, scale, rotation } satisfies Ellipsoid;
}

// Ellipsoid laid along the bone a→b at fraction t, nudged by offset.
function along(a: Vec3, b: Vec3, t: number, offset: Vec3, scale: Vec3) {
  const { rotation } = alignTo(a, b);
  const p = new Vector3(...a)
    .lerp(new Vector3(...b), t)
    .add(new Vector3(...offset));
  return ellipsoid(tuple(p), scale, rotation);
}

function capsule(a: Vec3, b: Vec3, radius: number): Capsule {
  const { length, rotation } = alignTo(a, b);
  const mid = new Vector3(...a).lerp(new Vector3(...b), 0.5);
  return { kind: "capsule", position: tuple(mid), rotation, radius, length };
}

// A ~1.8 m figure in a relaxed A-pose; y is up, +z faces the camera.
function joints(s: 1 | -1) {
  return {
    shoulder: [0.212 * s, 1.448, -0.005] as Vec3,
    elbow: [0.275 * s, 1.17, -0.02] as Vec3,
    wrist: [0.315 * s, 0.925, 0.015] as Vec3,
    hip: [0.094 * s, 0.93, 0] as Vec3,
    knee: [0.104 * s, 0.505, 0.012] as Vec3,
    ankle: [0.101 * s, 0.095, -0.012] as Vec3,
  };
}
const SIDES = [1, -1] as const;

export const SKIN: Shape[] = [
  ellipsoid([0, 1.712, 0.005], [0.094, 0.118, 0.106]),
  capsule([0, 1.53, -0.01], [0, 1.63, 0], 0.056),
  ellipsoid([0, 1.35, -0.005], [0.185, 0.19, 0.115]),
  ellipsoid([0, 1.15, 0], [0.145, 0.16, 0.095]),
  ellipsoid([0, 0.96, -0.005], [0.165, 0.11, 0.105]),
  ...SIDES.flatMap((s) => {
    const j = joints(s);
    return [
      capsule(j.shoulder, j.elbow, 0.05),
      capsule(j.elbow, j.wrist, 0.041),
      ellipsoid(
        [0.326 * s, 0.852, 0.02],
        [0.032, 0.064, 0.044],
        [0, 0, 0.1 * s],
      ),
      capsule(j.hip, j.knee, 0.078),
      capsule(j.knee, j.ankle, 0.052),
      ellipsoid([0.103 * s, 0.04, 0.045], [0.047, 0.037, 0.112]),
    ];
  }),
];

function mirrored(make: (s: 1 | -1) => Shape[]) {
  return SIDES.flatMap(make);
}

export const MUSCLES: Record<MuscleKey, Shape[]> = {
  chest: mirrored((s) => [
    ellipsoid(
      [0.083 * s, 1.392, 0.064],
      [0.094, 0.07, 0.05],
      [0.18, 0.1 * s, -0.2 * s],
    ),
  ]),
  abs: [0, 1].flatMap((col) =>
    [
      [1.245, 0.088],
      [1.177, 0.086],
      [1.109, 0.083],
    ].map(([y, z], row): RoundedBox => ({
      kind: "box",
      position: [(col ? -1 : 1) * 0.031, y, z],
      size: [0.048, 0.058, 0.022],
      rotation: [-0.12 + row * 0.1, 0, 0],
    })),
  ),
  shoulders: mirrored((s) => [
    ellipsoid(
      [0.217 * s, 1.432, -0.002],
      [0.07, 0.08, 0.072],
      [0, 0, -0.38 * s],
    ),
  ]),
  biceps: mirrored((s) => {
    const j = joints(s);
    return [
      along(j.shoulder, j.elbow, 0.56, [0, 0, 0.024], [0.042, 0.105, 0.036]),
    ];
  }),
  triceps: mirrored((s) => {
    const j = joints(s);
    return [
      along(
        j.shoulder,
        j.elbow,
        0.45,
        [0.004 * s, 0, -0.024],
        [0.044, 0.12, 0.038],
      ),
    ];
  }),
  forearms: mirrored((s) => {
    const j = joints(s);
    return [
      along(j.elbow, j.wrist, 0.3, [0.003 * s, 0, 0.003], [0.05, 0.1, 0.048]),
    ];
  }),
  back: [
    ellipsoid([0, 1.47, -0.055], [0.13, 0.07, 0.05], [0.35, 0, 0]),
    ...mirrored((s) => [
      ellipsoid(
        [0.1 * s, 1.29, -0.058],
        [0.085, 0.155, 0.045],
        [-0.1, 0.22 * s, 0.22 * s],
      ),
      ellipsoid([0.032 * s, 1.12, -0.078], [0.03, 0.095, 0.022]),
    ]),
  ],
  glutes: mirrored((s) => [
    ellipsoid([0.072 * s, 0.93, -0.05], [0.085, 0.09, 0.062], [0, 0.18 * s, 0]),
  ]),
  quads: mirrored((s) => {
    const j = joints(s);
    return [
      along(j.hip, j.knee, 0.46, [0.006 * s, 0, 0.03], [0.068, 0.2, 0.055]),
      along(j.hip, j.knee, 0.8, [-0.028 * s, 0, 0.03], [0.036, 0.075, 0.036]),
    ];
  }),
  hamstrings: mirrored((s) => {
    const j = joints(s);
    return [along(j.hip, j.knee, 0.5, [0, 0, -0.03], [0.064, 0.19, 0.054])];
  }),
  calves: mirrored((s) => {
    const j = joints(s);
    return [
      along(j.knee, j.ankle, 0.3, [0.014 * s, 0, -0.028], [0.034, 0.1, 0.04]),
      along(
        j.knee,
        j.ankle,
        0.3,
        [-0.014 * s, 0, -0.028],
        [0.034, 0.105, 0.04],
      ),
    ];
  }),
};

// Which way the camera should face to see a muscle best.
export const FACING: Record<MuscleKey, "front" | "back"> = {
  chest: "front",
  abs: "front",
  shoulders: "front",
  biceps: "front",
  forearms: "front",
  quads: "front",
  back: "back",
  triceps: "back",
  glutes: "back",
  hamstrings: "back",
  calves: "back",
};
