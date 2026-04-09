import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Color constants - Javanese palette
const TEAK_DARK = "#654321";
const TEAK_MED = "#8B6914";
const TEAK_LIGHT = "#A0784C";
const GOLD = "#DAA520";
const TERRACOTTA = "#CC5500";
const FLOOR_BROWN = "#B8A088";
const BATIK_BLUE = "#1B3A5C";
const BATIK_RED = "#8B1A1A";
const BATIK_CREAM = "#F5E6CC";

// ─── Saka Guru (Main Pillar) ────────────────────────────────
export function SakaGuru({ position, height = 3.5 }: { position: [number, number, number]; height?: number }) {
  return (
    <group position={position}>
      {/* Umpak (stone base) */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.2, 0.5]} />
        <meshStandardMaterial color="#8B8682" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.4, 0.04, 0.4]} />
        <meshStandardMaterial color="#9B9590" roughness={0.8} />
      </mesh>
      {/* Pillar */}
      <mesh position={[0, height / 2 + 0.24, 0]} castShadow>
        <boxGeometry args={[0.25, height, 0.25]} />
        <meshStandardMaterial color={TEAK_DARK} roughness={0.7} />
      </mesh>
      {/* Capital (carved top) */}
      <mesh position={[0, height + 0.24, 0]} castShadow>
        <boxGeometry args={[0.35, 0.12, 0.35]} />
        <meshStandardMaterial color={TEAK_MED} />
      </mesh>
      {/* Gold accent ring */}
      <mesh position={[0, height + 0.1, 0]}>
        <boxGeometry args={[0.28, 0.03, 0.28]} />
        <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

// ─── Secondary Pillar ───────────────────────────────────────
export function Pillar({ position, height = 2.8 }: { position: [number, number, number]; height?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.3, 0.16, 0.3]} />
        <meshStandardMaterial color="#8B8682" roughness={0.9} />
      </mesh>
      <mesh position={[0, height / 2 + 0.16, 0]} castShadow>
        <boxGeometry args={[0.18, height, 0.18]} />
        <meshStandardMaterial color={TEAK_DARK} roughness={0.7} />
      </mesh>
    </group>
  );
}

// ─── Wooden Bench (Bangku Jawa) ─────────────────────────────
export function WoodenBench({
  position,
  rotation = 0,
  width = 1.8,
}: {
  position: [number, number, number];
  rotation?: number;
  width?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.06, 0.5]} />
        <meshStandardMaterial color={TEAK_MED} roughness={0.6} />
      </mesh>
      {/* Legs */}
      {[[-width / 2 + 0.08, 0.2, -0.18], [width / 2 - 0.08, 0.2, -0.18],
        [-width / 2 + 0.08, 0.2, 0.18], [width / 2 - 0.08, 0.2, 0.18]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.08, 0.4, 0.08]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}
      {/* Cross beam */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[width - 0.2, 0.04, 0.04]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
    </group>
  );
}

// ─── Low Table (Meja Pendek) ────────────────────────────────
export function LowTable({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.05, 0.6]} />
        <meshStandardMaterial color={TEAK_LIGHT} roughness={0.5} />
      </mesh>
      {[[-0.4, 0.14, -0.22], [0.4, 0.14, -0.22],
        [-0.4, 0.14, 0.22], [0.4, 0.14, 0.22]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.06, 0.28, 0.06]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Work Desk (with monitor — modern touch in traditional setting) ──
export function WorkDesk({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Table top - carved wood style */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.06, 0.7]} />
        <meshStandardMaterial color={TEAK_MED} roughness={0.5} />
      </mesh>
      {/* Carved edge detail */}
      <mesh position={[0, 0.72, -0.33]}>
        <boxGeometry args={[1.4, 0.04, 0.02]} />
        <meshStandardMaterial color={GOLD} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Legs */}
      {[[-0.6, 0.37, -0.28], [0.6, 0.37, -0.28],
        [-0.6, 0.37, 0.28], [0.6, 0.37, 0.28]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.07, 0.74, 0.07]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}
      {/* Monitor/Laptop */}
      <mesh position={[0, 1.15, -0.15]} castShadow>
        <boxGeometry args={[0.6, 0.4, 0.03]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[0, 1.15, -0.13]}>
        <boxGeometry args={[0.52, 0.32, 0.01]} />
        <meshStandardMaterial color="#E8F4FD" emissive="#B8D4E8" emissiveIntensity={0.3} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.93, -0.15]} castShadow>
        <boxGeometry args={[0.04, 0.16, 0.04]} />
        <meshStandardMaterial color="#555" metalness={0.5} />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 0.79, 0.1]}>
        <boxGeometry args={[0.35, 0.015, 0.12]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {/* Stool */}
      <JogloStool position={[0, 0, 0.6]} />
    </group>
  );
}

function JogloStool({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.4, 0.04, 0.4]} />
        <meshStandardMaterial color={TEAK_MED} />
      </mesh>
      {[[-0.15, 0.17, -0.15], [0.15, 0.17, -0.15],
        [-0.15, 0.17, 0.15], [0.15, 0.17, 0.15]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <boxGeometry args={[0.05, 0.34, 0.05]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Gamelan Set ────────────────────────────────────────────
export function GamelanSet({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Gong frame */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[0.08, 1.6, 0.08]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      <mesh position={[1.2, 0.8, 0]} castShadow>
        <boxGeometry args={[0.08, 1.6, 0.08]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Top beam */}
      <mesh position={[0.6, 1.6, 0]} castShadow>
        <boxGeometry args={[1.3, 0.08, 0.08]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Carved detail on beam */}
      <mesh position={[0.6, 1.6, 0.05]}>
        <boxGeometry args={[1.0, 0.04, 0.01]} />
        <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Gong (big) */}
      <mesh position={[0.6, 0.9, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.08, 24]} />
        <meshStandardMaterial color="#CD853F" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Gong boss (center bump) */}
      <mesh position={[0.6, 0.9, 0.06]}>
        <sphereGeometry args={[0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#DAA520" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Saron (xylophone-like) in front */}
      <group position={[-0.3, 0, 0.8]}>
        {/* Frame */}
        <mesh position={[0.5, 0.2, 0]} castShadow>
          <boxGeometry args={[1.2, 0.04, 0.35]} />
          <meshStandardMaterial color={TEAK_MED} />
        </mesh>
        {/* Legs */}
        {[[0, 0.1, 0], [1.0, 0.1, 0]].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]}>
            <boxGeometry args={[0.06, 0.2, 0.3]} />
            <meshStandardMaterial color={TEAK_DARK} />
          </mesh>
        ))}
        {/* Keys */}
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[0.1 + i * 0.13, 0.24, 0]} castShadow>
            <boxGeometry args={[0.1, 0.015, 0.2]} />
            <meshStandardMaterial color="#CD7F32" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ─── Batik Wall Hanging ─────────────────────────────────────
export function BatikHanging({
  position,
  rotation = 0,
  color = BATIK_BLUE,
}: {
  position: [number, number, number];
  rotation?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Rod */}
      <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 8]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Fabric */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.0, 1.0, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* Pattern stripes */}
      {[-0.3, 0, 0.3].map((y, i) => (
        <mesh key={i} position={[0, y, 0.015]}>
          <boxGeometry args={[0.9, 0.06, 0.005]} />
          <meshStandardMaterial color={GOLD} metalness={0.3} />
        </mesh>
      ))}
      {/* Diamond patterns */}
      {[-0.15, 0.15].map((y, i) => (
        <mesh key={i} position={[0, y, 0.015]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.12, 0.005]} />
          <meshStandardMaterial color={BATIK_CREAM} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Keris Display ──────────────────────────────────────────
export function KerisDisplay({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Stand base */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.2, 0.3, 0.12]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Top notch */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.15, 0.1, 0.1]} />
        <meshStandardMaterial color={TEAK_MED} />
      </mesh>
      {/* Keris blade */}
      <mesh position={[0, 0.55, 0]} rotation={[0, 0, 0.1]} castShadow>
        <boxGeometry args={[0.02, 0.35, 0.01]} />
        <meshStandardMaterial color="#B8860B" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Handle */}
      <mesh position={[0, 0.36, 0]} castShadow>
        <boxGeometry args={[0.04, 0.08, 0.04]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
    </group>
  );
}

// ─── Plant (Tropical) ───────────────────────────────────────
export function TropicalPlant({ position }: { position: [number, number, number] }) {
  const leavesRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!leavesRef.current) return;
    leavesRef.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.6) * 0.02;
  });

  return (
    <group position={position}>
      {/* Pot (traditional) */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.14, 0.3, 12]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <cylinderGeometry args={[0.19, 0.18, 0.02, 12]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.8} />
      </mesh>
      {/* Soil */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.02, 12]} />
        <meshStandardMaterial color="#3E2723" />
      </mesh>
      {/* Leaves */}
      <group ref={leavesRef}>
        {[0, 1.2, 2.4, 3.6, 5.0].map((angle, i) => (
          <mesh
            key={i}
            position={[
              Math.sin(angle) * 0.15,
              0.55 + i * 0.05,
              Math.cos(angle) * 0.15,
            ]}
            rotation={[0.3, angle, 0.2]}
            castShadow
          >
            <boxGeometry args={[0.04, 0.4, 0.15]} />
            <meshStandardMaterial color="#2E7D32" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ─── Hanging Lantern (Javanese style) ───────────────────────
export function HangingLantern({ position, color = "#FFF3E0" }: { position: [number, number, number]; color?: string }) {
  return (
    <group position={position}>
      {/* Chain */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.6, 4]} />
        <meshStandardMaterial color="#8B7355" />
      </mesh>
      {/* Lantern body */}
      <mesh position={[0, -0.35, 0]}>
        <boxGeometry args={[0.2, 0.25, 0.2]} />
        <meshStandardMaterial color={TEAK_MED} />
      </mesh>
      {/* Glass panels */}
      {[[0, 0, 0.105], [0, 0, -0.105], [0.105, 0, 0], [-0.105, 0, 0]].map((p, i) => (
        <mesh key={i} position={[p[0], -0.35 + p[1], p[2]]}>
          <boxGeometry args={i < 2 ? [0.14, 0.18, 0.005] : [0.005, 0.18, 0.14]} />
          <meshStandardMaterial color="#FFFDE7" transparent opacity={0.6} emissive="#FFE0B2" emissiveIntensity={0.3} />
        </mesh>
      ))}
      {/* Top cap */}
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[0.24, 0.04, 0.24]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Light */}
      <pointLight position={[0, -0.35, 0]} intensity={0.5} color="#FFE0B2" distance={5} />
    </group>
  );
}

// ─── Tikar (Woven Mat) ──────────────────────────────────────
export function Tikar({
  position,
  size = [2, 1.5],
  color = "#C8A96E",
}: {
  position: [number, number, number];
  size?: [number, number];
  color?: string;
}) {
  return (
    <group>
      <mesh position={[position[0], 0.01, position[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      {/* Border */}
      <mesh position={[position[0], 0.012, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size[0] - 0.1, size[1] - 0.1]} />
        <meshStandardMaterial color={BATIK_RED} roughness={1} transparent opacity={0.15} />
      </mesh>
    </group>
  );
}
