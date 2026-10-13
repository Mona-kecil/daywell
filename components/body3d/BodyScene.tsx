"use client";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CapsuleGeometry,
  Color,
  MathUtils,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type Group,
  type Material,
} from "three";
import {
  FACING,
  MUSCLE_KEYS,
  MUSCLES,
  SKIN,
  type MuscleKey,
  type Shape,
} from "./anatomy";
import { useIsDark } from "./useIsDark";

export type MuscleState = {
  kind: "never" | "recovering" | "ready";
  fraction: number;
  label: string;
};
export type BodyModelProps = {
  states: Partial<Record<MuscleKey, MuscleState>>;
  selected?: readonly MuscleKey[];
  onToggle?: (key: MuscleKey) => void;
  height?: number;
  // A small turntable preview: no toolbar, legend, or muscle picking.
  compact?: boolean;
};

const PALETTE = {
  light: {
    skin: "#d6dcd2",
    never: "#aeb8b0",
    sore: "#d4573b",
    mid: "#e2a03a",
    ready: "#3f9a6b",
  },
  dark: {
    skin: "#5f6f66",
    never: "#62706a",
    sore: "#ef7b5f",
    mid: "#efbd5f",
    ready: "#7fca9b",
  },
};

export function recoveryColor(state: MuscleState | undefined, dark: boolean) {
  const p = dark ? PALETTE.dark : PALETTE.light;
  if (!state || state.kind === "never") return new Color(p.never);
  if (state.kind === "ready") return new Color(p.ready);
  const f = state.fraction;
  return f < 0.5
    ? new Color().lerpColors(new Color(p.sore), new Color(p.mid), f / 0.5)
    : new Color().lerpColors(
        new Color(p.mid),
        new Color(p.ready),
        (f - 0.5) / 0.5,
      );
}

const SPHERE = new SphereGeometry(1, 40, 28);
const TURN = Math.PI;

function ShapeMesh({
  shape,
  material,
  handlers,
}: {
  shape: Shape;
  material: Material;
  handlers: {
    onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
    onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
    onClick?: (e: ThreeEvent<MouseEvent>) => void;
  };
}) {
  const capsule = useMemo(
    () =>
      shape.kind === "capsule"
        ? new CapsuleGeometry(shape.radius, shape.length, 8, 20)
        : null,
    [shape],
  );
  if (shape.kind === "box")
    return (
      <RoundedBox
        args={[...shape.size]}
        radius={0.013}
        smoothness={4}
        position={shape.position}
        rotation={shape.rotation}
        material={material}
        {...handlers}
      />
    );
  return (
    <mesh
      geometry={capsule ?? SPHERE}
      position={shape.position}
      rotation={shape.rotation}
      scale={shape.kind === "ellipsoid" ? shape.scale : 1}
      material={material}
      {...handlers}
    />
  );
}

function Muscle({
  name,
  state,
  selected,
  hovered,
  dark,
  onHover,
  onToggle,
}: {
  name: MuscleKey;
  state: MuscleState | undefined;
  selected: boolean;
  hovered: boolean;
  dark: boolean;
  onHover: (key: MuscleKey | null) => void;
  onToggle?: (key: MuscleKey) => void;
}) {
  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        roughness: 0.42,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        sheen: 0.4,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const color = recoveryColor(state, dark);
    material.color.copy(color);
    material.emissive.copy(color);
  }, [material, state, dark]);
  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
    const target = selected ? 0.28 + 0.3 * pulse : hovered ? 0.22 : 0;
    // three.js materials are mutable scene objects; per-frame writes are the r3f idiom.
    // eslint-disable-next-line react-hooks/immutability
    material.emissiveIntensity = MathUtils.lerp(
      material.emissiveIntensity,
      target,
      0.2,
    );
  });
  const handlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(name);
    },
    onPointerOut: () => onHover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.delta < 8) onToggle?.(name);
    },
  };
  return (
    <group scale={hovered || selected ? 1.035 : 1}>
      {MUSCLES[name].map((shape, i) => (
        <ShapeMesh
          key={i}
          shape={shape}
          material={material}
          handlers={handlers}
        />
      ))}
    </group>
  );
}

function Figure({
  states,
  selected,
  hovered,
  dark,
  yaw,
  idle,
  spin,
  onHover,
  onToggle,
}: {
  states: BodyModelProps["states"];
  selected: readonly MuscleKey[];
  hovered: MuscleKey | null;
  dark: boolean;
  yaw: React.RefObject<number>;
  idle: React.RefObject<number>;
  spin: boolean;
  onHover: (key: MuscleKey | null) => void;
  onToggle?: (key: MuscleKey) => void;
}) {
  const group = useRef<Group>(null);
  const skin = useMemo(
    () => new MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
    [],
  );
  useEffect(() => () => skin.dispose(), [skin]);
  useEffect(() => {
    skin.color.set(dark ? PALETTE.dark.skin : PALETTE.light.skin);
  }, [skin, dark]);
  useFrame(({ clock }, dt) => {
    if (!group.current) return;
    if (spin) {
      group.current.rotation.y += dt * 0.5;
      return;
    }
    const sway =
      performance.now() - idle.current > 3500
        ? Math.sin(clock.elapsedTime * 0.6) * 0.22
        : 0;
    group.current.rotation.y = MathUtils.damp(
      group.current.rotation.y,
      yaw.current + sway,
      5,
      dt,
    );
  });
  // The skin occludes muscles behind it, so taps on the front never reach the back.
  const block = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(null);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
  };
  return (
    <group ref={group}>
      {SKIN.map((shape, i) => (
        <ShapeMesh key={i} shape={shape} material={skin} handlers={block} />
      ))}
      {MUSCLE_KEYS.map((key) => (
        <Muscle
          key={key}
          name={key}
          state={states[key]}
          selected={selected.includes(key)}
          hovered={hovered === key}
          dark={dark}
          onHover={onHover}
          onToggle={onToggle}
        />
      ))}
    </group>
  );
}

function nearestYaw(current: number, facing: "front" | "back") {
  const base = Math.round(current / (2 * TURN)) * 2 * TURN;
  const options =
    facing === "front"
      ? [base - 2 * TURN, base, base + 2 * TURN]
      : [base - TURN, base + TURN];
  return options.reduce((a, b) =>
    Math.abs(b - current) < Math.abs(a - current) ? b : a,
  );
}

function facingOf(yaw: number) {
  const turns = (((yaw % (2 * TURN)) + 2 * TURN) % (2 * TURN)) / TURN;
  return turns > 0.5 && turns < 1.5 ? "back" : "front";
}

export default function BodyScene({
  states,
  selected = [],
  onToggle,
  height = 400,
  compact = false,
}: BodyModelProps) {
  const dark = useIsDark();
  const reduceMotion = useReducedMotion();
  const yaw = useRef(0);
  const idle = useRef(0);
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [hovered, setHovered] = useState<MuscleKey | null>(null);
  const [focus, setFocus] = useState<MuscleKey | null>(null);
  const drag = useRef<{ x: number; yaw: number } | null>(null);

  const turnTo = (side: "front" | "back") => {
    yaw.current = nearestYaw(yaw.current, side);
    idle.current = performance.now();
    setFacing(side);
  };

  const previous = useRef(selected);
  useEffect(() => {
    const added = selected.find((k) => !previous.current.includes(k));
    previous.current = selected;
    if (!added) return;
    setFocus(added);
    if (FACING[added] !== facingOf(yaw.current)) turnTo(FACING[added]);
  }, [selected]);

  const onPointerDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, yaw: yaw.current };
    idle.current = performance.now();
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      yaw.current = drag.current.yaw + (ev.clientX - drag.current.x) * 0.012;
      idle.current = performance.now();
    };
    const up = () => {
      drag.current = null;
      setFacing(facingOf(yaw.current));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const shown = hovered ?? focus;
  const shownState = shown ? states[shown] : undefined;

  return (
    <div className={compact ? "body3d compact" : "body3d"} style={{ height }}>
      <div
        className="body3d-stage"
        onPointerDown={compact ? undefined : onPointerDown}
        style={{ cursor: compact ? "inherit" : hovered ? "pointer" : "grab" }}
      >
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0.92, 3.45], fov: 30 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.89, 0)}
          gl={{ antialias: true, alpha: true }}
          fallback={
            <p className="muted small body3d-fallback">
              3D view isn’t available on this device.
            </p>
          }
          onPointerMissed={() => setHovered(null)}
        >
          <hemisphereLight
            args={[
              dark ? "#c9e2d3" : "#ffffff",
              dark ? "#1a2420" : "#c7cfc2",
              0.9,
            ]}
          />
          <directionalLight
            position={[2.2, 3.2, 3]}
            intensity={dark ? 1.5 : 1.9}
          />
          <directionalLight
            position={[-2.5, 2, -3]}
            intensity={dark ? 1.4 : 0.9}
            color={dark ? "#9fd3c0" : "#dce9ff"}
          />
          <directionalLight position={[0, 0.6, 3]} intensity={0.35} />
          <Figure
            states={states}
            selected={selected}
            hovered={hovered}
            dark={dark}
            yaw={yaw}
            idle={idle}
            spin={compact && !reduceMotion}
            onHover={compact ? () => {} : setHovered}
            onToggle={
              compact
                ? undefined
                : (key) => {
                    setFocus(key);
                    onToggle?.(key);
                  }
            }
          />
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={dark ? 0.55 : 0.32}
            scale={1.8}
            blur={2.6}
            far={1.2}
            resolution={512}
            color={dark ? "#000000" : "#2a3d33"}
          />
        </Canvas>
      </div>
      {!compact && (
        <>
          <div className="body3d-toolbar">
            <div className="segmented" role="group" aria-label="Body view">
              {(["front", "back"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={facing === side}
                  onClick={() => turnTo(side)}
                >
                  {side === "front" ? "Front" : "Back"}
                </button>
              ))}
            </div>
            <p className="body3d-caption" aria-live="polite">
              {shown ? (
                <>
                  <strong className="capitalize">{shown}</strong>
                  <span className="muted">
                    {" "}
                    · {shownState?.label ?? "Not tracked"}
                  </span>
                </>
              ) : (
                <span className="muted">Drag to turn · tap a muscle</span>
              )}
            </p>
          </div>
          <div className="body3d-legend" aria-hidden>
            <span>Sore</span>
            <i />
            <span>Ready</span>
          </div>
        </>
      )}
    </div>
  );
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduce;
}
