import { useRef, useState, useCallback, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { MinionState } from "../../types";
import { useStore } from "../../store";

// Global minion positions for separation steering
const minionPositions: Map<string, THREE.Vector3> = new Map();
export function getMinionPositions() { return minionPositions; }

// Waypoints around the joglo
const WAYPOINTS: [number, number][] = [
  [-3, -3], [0, -3], [3, -3],     // near desks
  [-2, 0], [2, 0], [0, 0],        // center pendopo
  [-4, 3], [4, 3], [0, 4],        // front area
  [-5, -1], [5, -1],              // sides
  [0, 5],                          // front bench
  [-3, 4], [3, 4],                // front corners
];

const DESK_POSITIONS: [number, number][] = [
  [-4.5, -5.3], [-1.5, -5.3], [1.5, -5.3], [4.5, -5.3],
];

type AnimState = "idle" | "walking" | "working";
type Expression = "neutral" | "focused" | "happy" | "sad";

interface MinionProps {
  minion: MinionState;
  startPosition: [number, number];
  isSleeping?: boolean;
}

export function Minion({ minion, startPosition, isSleeping }: MinionProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [expression, setExpression] = useState<Expression>("neutral");
  const { selectedMinionId, selectMinion } = useStore();
  const isSelected = selectedMinionId === minion.id;
  const prevStatus = useRef(minion.status);

  // Track expression based on status changes
  useEffect(() => {
    if (isSleeping) {
      setExpression("focused"); // squinted eyes = sleeping
    } else if (minion.status === "working") {
      setExpression("focused");
    } else if (minion.status === "error") {
      setExpression("sad");
      setTimeout(() => setExpression("neutral"), 5000);
    } else if (prevStatus.current === "working" && minion.status === "idle") {
      // Just finished working → happy!
      setExpression("happy");
      setTimeout(() => setExpression("neutral"), 4000);
    } else {
      setExpression("neutral");
    }
    prevStatus.current = minion.status;
  }, [minion.status, isSleeping]);

  const moveState = useRef({
    position: new THREE.Vector3(startPosition[0], 0, startPosition[1]),
    target: new THREE.Vector3(startPosition[0], 0, startPosition[1]),
    rotation: 0,
    targetRotation: 0,
    animState: "idle" as AnimState,
    idleTimer: Math.random() * 3 + 1,
    walkSpeed: 0.8 + Math.random() * 0.4,
    // Reusable vectors to avoid GC pressure in useFrame
    _dir: new THREE.Vector3(),
    _push: new THREE.Vector3(),
  });

  const pickNewTarget = useCallback(() => {
    const state = moveState.current;
    if (minion.status === "working") {
      const desk = DESK_POSITIONS[Math.floor(Math.random() * DESK_POSITIONS.length)];
      state.target.set(desk[0], 0, desk[1]);
    } else {
      const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
      state.target.set(wp[0], 0, wp[1]);
    }
    const dx = state.target.x - state.position.x;
    const dz = state.target.z - state.position.z;
    state.targetRotation = Math.atan2(dx, dz);
    state.animState = "walking";
  }, [minion.status]);

  useEffect(() => {
    if (minion.status === "working") pickNewTarget();
  }, [minion.status, pickNewTarget]);

  // Cleanup global position on unmount
  useEffect(() => {
    return () => { minionPositions.delete(minion.id); };
  }, [minion.id]);

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const state = moveState.current;
    const t = clock.getElapsedTime();

    if (state.animState === "idle") {
      state.idleTimer -= delta;
      if (state.idleTimer <= 0 && !isSleeping) pickNewTarget();
    } else if (state.animState === "walking") {
      const rotDiff = state.targetRotation - state.rotation;
      const normalizedDiff = ((rotDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      state.rotation += normalizedDiff * Math.min(1, delta * 5);

      const dir = state._dir.subVectors(state.target, state.position).normalize();
      const dist = state.position.distanceTo(state.target);

      if (dist > 0.15) {
        state.position.add(dir.multiplyScalar(Math.min(state.walkSpeed * delta, dist)));
      } else {
        if (minion.status === "working") {
          state.animState = "working";
          state.targetRotation = Math.PI;
          state.rotation = Math.PI;
        } else {
          state.animState = "idle";
          state.idleTimer = 2 + Math.random() * 5;
        }
      }
    } else if (state.animState === "working" && minion.status !== "working") {
      state.animState = "idle";
      state.idleTimer = 1;
    }

    // Separation steering — push away from other minions
    for (const [otherId, otherPos] of minionPositions) {
      if (otherId === minion.id) continue;
      const dist = state.position.distanceTo(otherPos);
      if (dist < 0.8 && dist > 0.01) {
        state._push.subVectors(state.position, otherPos).normalize();
        state.position.add(state._push.multiplyScalar(0.02));
      }
    }

    // Update global position for other minions
    minionPositions.set(minion.id, state.position.clone());

    groupRef.current.position.copy(state.position);
    groupRef.current.rotation.y = state.rotation;

    if (state.animState === "walking") {
      groupRef.current.position.y = Math.abs(Math.sin(t * 6)) * 0.04;
    } else {
      groupRef.current.position.y = 0;
    }
  });

  return (
    <group
      ref={groupRef}
      onClick={(e) => { e.stopPropagation(); selectMinion(isSelected ? null : minion.id); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "default"; }}
    >
      <PunakawanBody
        characterId={minion.id}
        outfit={minion.outfit}
        animState={moveState.current.animState}
        isWorking={minion.status === "working"}
        hovered={hovered}
        isSelected={isSelected}
        accentColor={minion.color}
        expression={expression}
      />

      {/* Floating label */}
      <Html position={[0, getLabelHeight(minion.id), 0]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <div style={{
          background: minion.status === "working" ? "rgba(139, 69, 19, 0.95)" : "rgba(255, 248, 235, 0.95)",
          color: minion.status === "working" ? "#FFE0B2" : "#5D4037",
          padding: "4px 12px",
          borderRadius: "8px",
          fontSize: "11px",
          fontFamily: "'Inter', sans-serif",
          textAlign: "center",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          border: `2px solid ${minion.color}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: "12px" }}>{minion.name}</div>
          <div style={{ fontSize: "9px", opacity: 0.7 }}>{minion.role}</div>
        </div>
      </Html>

      {isSelected && <SelectionRing color={minion.color} />}
    </group>
  );
}

function getLabelHeight(id: string): number {
  switch (id) {
    case "semar": return 1.8;
    case "gareng": return 2.0;
    case "petruk": return 2.6;
    case "bagong": return 1.9;
    default: return 2.1;
  }
}

function SelectionRing({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.z = clock.getElapsedTime() * 0.5;
      (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(clock.getElapsedTime() * 3) * 0.2;
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[0.55, 0.68, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} />
    </mesh>
  );
}

// ─── Punakawan Bodies ───────────────────────────────────────
interface BodyProps {
  characterId: string;
  outfit: MinionState["outfit"];
  animState: AnimState;
  isWorking: boolean;
  hovered: boolean;
  isSelected: boolean;
  accentColor: string;
  expression: Expression;
}

function PunakawanBody(props: BodyProps) {
  switch (props.characterId) {
    case "semar": return <SemarBody {...props} />;
    case "gareng": return <GarengBody {...props} />;
    case "petruk": return <PetrukBody {...props} />;
    case "bagong": return <BagongBody {...props} />;
    default: return <SemarBody {...props} />;
  }
}

// ── SEMAR: Short, very fat, round belly, white face, kuncung ──
function SemarBody({ outfit, animState, isWorking, hovered, accentColor, expression }: BodyProps) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  useAnimations({ leftArmRef, rightArmRef, leftLegRef, rightLegRef, animState, isWorking });

  const glow = hovered ? 0.15 : 0;

  return (
    <group>
      {/* Big round body */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshStandardMaterial color={outfit.shirtColor} emissive={accentColor} emissiveIntensity={glow} />
      </mesh>
      {/* Belly protrusion */}
      <mesh position={[0, 0.55, 0.2]} castShadow>
        <sphereGeometry args={[0.3, 12, 10]} />
        <meshStandardMaterial color={outfit.shirtColor} />
      </mesh>

      {/* Head - white face, black body */}
      <group position={[0, 1.2, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.25, 14, 10]} />
          <meshStandardMaterial color="#F5E6CC" /> {/* White/light face */}
        </mesh>
        {/* Kuncung (white tuft on head) */}
        <mesh position={[0, 0.25, -0.05]} castShadow>
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
        {/* Eyes - expression-based */}
        <mesh position={[-0.08, 0.02, 0.22]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.03, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.08, 0.02, 0.22]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.03, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* Flat/pug nose */}
        <mesh position={[0, -0.03, 0.24]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
        {/* Expression mouth */}
        <ExpressionMouth expression={expression} />
      </group>

      {/* Sarong/kain */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.3, 0.35, 12]} />
        <meshStandardMaterial color={outfit.pantsColor} />
      </mesh>

      {/* Arms */}
      <group ref={leftArmRef} position={[-0.45, 0.8, 0]}>
        <mesh castShadow><boxGeometry args={[0.15, 0.4, 0.15]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightArmRef} position={[0.45, 0.8, 0]}>
        <mesh castShadow><boxGeometry args={[0.15, 0.4, 0.15]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>

      {/* Legs (short) */}
      <group ref={leftLegRef} position={[-0.15, 0.15, 0]}>
        <mesh castShadow><boxGeometry args={[0.16, 0.3, 0.16]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightLegRef} position={[0.15, 0.15, 0]}>
        <mesh castShadow><boxGeometry args={[0.16, 0.3, 0.16]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
    </group>
  );
}

// ── GARENG: Short, thin, cross-eyed, withered hand ──
function GarengBody({ outfit, animState, isWorking, hovered, accentColor, expression }: BodyProps) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  useAnimations({ leftArmRef, rightArmRef, leftLegRef, rightLegRef, animState, isWorking });

  const glow = hovered ? 0.15 : 0;

  return (
    <group>
      {/* Slim torso */}
      <mesh position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[0.35, 0.5, 0.25]} />
        <meshStandardMaterial color={outfit.shirtColor} emissive={accentColor} emissiveIntensity={glow} />
      </mesh>

      {/* Head */}
      <group position={[0, 1.3, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.22, 14, 10]} />
          <meshStandardMaterial color="#F5E6CC" />
        </mesh>
        {/* Cross eyes - expression-based */}
        <mesh position={[-0.07, 0.03, 0.2]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.03, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.1, 0.05, 0.2]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.025, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* Nose */}
        <mesh position={[0, -0.02, 0.21]}>
          <sphereGeometry args={[0.04, 8, 6]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
        <ExpressionMouth expression={expression} y={-0.09} z={0.2} width={0.06} />
      </group>

      {/* Sarong */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.22]} />
        <meshStandardMaterial color={outfit.pantsColor} />
      </mesh>

      {/* Left arm (withered - smaller) */}
      <group ref={leftArmRef} position={[-0.25, 0.9, 0]}>
        <mesh castShadow><boxGeometry args={[0.1, 0.35, 0.1]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
        <mesh position={[0, -0.2, 0]} castShadow>
          <boxGeometry args={[0.06, 0.12, 0.06]} /> {/* Withered hand */}
          <meshStandardMaterial color={outfit.skinColor} />
        </mesh>
      </group>
      {/* Right arm (normal) */}
      <group ref={rightArmRef} position={[0.25, 0.9, 0]}>
        <mesh castShadow><boxGeometry args={[0.12, 0.4, 0.12]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>

      {/* Left leg (clubfoot - slightly offset) */}
      <group ref={leftLegRef} position={[-0.1, 0.25, 0]}>
        <mesh castShadow><boxGeometry args={[0.14, 0.4, 0.14]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
        <mesh position={[-0.03, -0.22, 0.04]} castShadow>
          <boxGeometry args={[0.15, 0.06, 0.18]} /><meshStandardMaterial color={outfit.shoeColor} />
        </mesh>
      </group>
      {/* Right leg */}
      <group ref={rightLegRef} position={[0.1, 0.25, 0]}>
        <mesh castShadow><boxGeometry args={[0.14, 0.4, 0.14]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
        <mesh position={[0, -0.22, 0.04]} castShadow>
          <boxGeometry args={[0.14, 0.06, 0.18]} /><meshStandardMaterial color={outfit.shoeColor} />
        </mesh>
      </group>
    </group>
  );
}

// ── PETRUK: Tall, lanky, VERY LONG NOSE, big smile ──
function PetrukBody({ outfit, animState, isWorking, hovered, accentColor, expression }: BodyProps) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  useAnimations({ leftArmRef, rightArmRef, leftLegRef, rightLegRef, animState, isWorking });

  const glow = hovered ? 0.15 : 0;

  return (
    <group>
      {/* Tall slim torso */}
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.4, 0.7, 0.25]} />
        <meshStandardMaterial color={outfit.shirtColor} emissive={accentColor} emissiveIntensity={glow} />
      </mesh>

      {/* Head (larger) */}
      <group position={[0, 1.75, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.25, 14, 10]} />
          <meshStandardMaterial color="#F5E6CC" />
        </mesh>
        {/* Bright eyes - expression */}
        <mesh position={[-0.08, 0.04, 0.22]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.08, 0.04, 0.22]} scale={[1, EyeSquint({ expression }), 1]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* VERY LONG NOSE — signature feature */}
        <mesh position={[0, -0.02, 0.35]} rotation={[0.3, 0, 0]} castShadow>
          <boxGeometry args={[0.06, 0.06, 0.22]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
        <mesh position={[0, -0.04, 0.46]}>
          <sphereGeometry args={[0.04, 8, 6]} />
          <meshStandardMaterial color="#DCC8A8" />
        </mesh>
        <ExpressionMouth expression={expression} y={-0.12} z={0.22} width={0.14} />
        {/* Large ears */}
        <mesh position={[-0.25, 0, 0]} castShadow>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
        <mesh position={[0.25, 0, 0]} castShadow>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
      </group>

      {/* Sarong */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.35, 0.5, 0.22]} />
        <meshStandardMaterial color={outfit.pantsColor} />
      </mesh>

      {/* Long arms */}
      <group ref={leftArmRef} position={[-0.3, 1.15, 0]}>
        <mesh castShadow><boxGeometry args={[0.12, 0.55, 0.12]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightArmRef} position={[0.3, 1.15, 0]}>
        <mesh castShadow><boxGeometry args={[0.12, 0.55, 0.12]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>

      {/* Long legs */}
      <group ref={leftLegRef} position={[-0.1, 0.3, 0]}>
        <mesh castShadow><boxGeometry args={[0.14, 0.55, 0.14]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightLegRef} position={[0.1, 0.3, 0]}>
        <mesh castShadow><boxGeometry args={[0.14, 0.55, 0.14]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
    </group>
  );
}

// ── BAGONG: Fat, round, wide eyes, big grin, bold ──
function BagongBody({ outfit, animState, isWorking, hovered, accentColor, expression }: BodyProps) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  useAnimations({ leftArmRef, rightArmRef, leftLegRef, rightLegRef, animState, isWorking });

  const glow = hovered ? 0.15 : 0;

  return (
    <group>
      {/* Very round body */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshStandardMaterial color={outfit.shirtColor} emissive={accentColor} emissiveIntensity={glow} />
      </mesh>

      {/* Head - wider face */}
      <group position={[0, 1.25, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.27, 14, 10]} />
          <meshStandardMaterial color="#F5E6CC" />
        </mesh>
        {/* Wide eyes */}
        <mesh position={[-0.1, 0.04, 0.24]}>
          <sphereGeometry args={[0.04, 8, 6]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
        <mesh position={[-0.1, 0.04, 0.27]}>
          <sphereGeometry args={[0.02, 6, 4]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0.1, 0.04, 0.24]}>
          <sphereGeometry args={[0.04, 8, 6]} />
          <meshStandardMaterial color="#FFFFFF" />
        </mesh>
        <mesh position={[0.1, 0.04, 0.27]}>
          <sphereGeometry args={[0.02, 6, 4]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {/* Nose (round) */}
        <mesh position={[0, -0.02, 0.26]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#E8D5B7" />
        </mesh>
        <ExpressionMouth expression={expression} y={-0.12} z={0.23} width={0.16} />
        {/* Teeth showing */}
        {expression !== "sad" && (
          <mesh position={[0, -0.1, 0.24]}>
            <boxGeometry args={[0.1, 0.02, 0.01]} />
            <meshStandardMaterial color="#FFFFFF" />
          </mesh>
        )}
      </group>

      {/* Sarong */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.33, 0.28, 0.35, 12]} />
        <meshStandardMaterial color={outfit.pantsColor} />
      </mesh>

      {/* Arms */}
      <group ref={leftArmRef} position={[-0.42, 0.8, 0]}>
        <mesh castShadow><boxGeometry args={[0.15, 0.4, 0.15]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightArmRef} position={[0.42, 0.8, 0]}>
        <mesh castShadow><boxGeometry args={[0.15, 0.4, 0.15]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>

      {/* Short legs */}
      <group ref={leftLegRef} position={[-0.15, 0.18, 0]}>
        <mesh castShadow><boxGeometry args={[0.16, 0.35, 0.16]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
      <group ref={rightLegRef} position={[0.15, 0.18, 0]}>
        <mesh castShadow><boxGeometry args={[0.16, 0.35, 0.16]} /><meshStandardMaterial color={outfit.skinColor} /></mesh>
      </group>
    </group>
  );
}

// ─── Expression Helper ─────────────────────────────────────
function ExpressionMouth({ expression, x = 0, y = -0.1, z = 0.23, width = 0.1 }: {
  expression: Expression; x?: number; y?: number; z?: number; width?: number;
}) {
  // Mouth shape changes per expression
  const h = expression === "happy" ? 0.04 : expression === "sad" ? 0.03 : 0.02;
  const color = expression === "happy" ? "#C62828" : expression === "sad" ? "#5D4037" : "#8B0000";
  const curve = expression === "happy" ? 0.02 : expression === "sad" ? -0.02 : 0;

  return (
    <group position={[x, y, z]}>
      <mesh>
        <boxGeometry args={[width, h, 0.02]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Curve indicator */}
      {expression !== "neutral" && (
        <mesh position={[0, curve, 0.005]}>
          <boxGeometry args={[width * 0.6, 0.015, 0.01]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}

function EyeSquint({ expression, scaleY = 1 }: { expression: Expression; scaleY?: number }) {
  // Focused = squinted (flat), happy = curved up, sad = droopy
  if (expression === "focused") return 0.4 * scaleY;
  if (expression === "happy") return 0.7 * scaleY;
  return scaleY;
}

// ─── Shared Animation Hook ──────────────────────────────────
function useAnimations({
  leftArmRef, rightArmRef, leftLegRef, rightLegRef, animState, isWorking,
}: {
  leftArmRef: React.RefObject<THREE.Group | null>;
  rightArmRef: React.RefObject<THREE.Group | null>;
  leftLegRef: React.RefObject<THREE.Group | null>;
  rightLegRef: React.RefObject<THREE.Group | null>;
  animState: AnimState;
  isWorking: boolean;
}) {
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (animState === "walking") {
      const swing = Math.sin(t * 6) * 0.4;
      if (leftLegRef.current) leftLegRef.current.rotation.x = swing;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -swing;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -swing * 0.6;
      if (rightArmRef.current) rightArmRef.current.rotation.x = swing * 0.6;
    } else if (animState === "working" || isWorking) {
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 5) * 0.25 - 0.4;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 5 + 1) * 0.25 - 0.4;
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
    } else {
      const idle = Math.sin(t * 1.2) * 0.02;
      if (leftArmRef.current) leftArmRef.current.rotation.x = idle;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -idle;
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
    }
  });
}
