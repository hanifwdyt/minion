import {
  SakaGuru,
  Pillar,
  WoodenBench,
  LowTable,
  WorkDesk,
  GamelanSet,
  BatikHanging,
  KerisDisplay,
  TropicalPlant,
  HangingLantern,
  Tikar,
} from "./Furniture";

const FLOOR_SIZE = 16;

// Colors
const TEAK_DARK = "#654321";
const TERRACOTTA = "#CC5500";
const FLOOR_COLOR = "#C4A882";
const ROOF_COLOR = "#8B4513";

function Floor() {
  return (
    <group>
      {/* Main floor - polished cement / tile */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.6} />
      </mesh>
    </group>
  );
}

function JogloRoof() {
  return (
    <group>
      {/* Main roof beams connecting saka guru */}
      {/* Front-back beams */}
      <mesh position={[-2.5, 3.75, 0]} castShadow>
        <boxGeometry args={[0.15, 0.15, 7]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      <mesh position={[2.5, 3.75, 0]} castShadow>
        <boxGeometry args={[0.15, 0.15, 7]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Left-right beams */}
      <mesh position={[0, 3.75, -3]} castShadow>
        <boxGeometry args={[5.2, 0.15, 0.15]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      <mesh position={[0, 3.75, 3]} castShadow>
        <boxGeometry args={[5.2, 0.15, 0.15]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>

      {/* Outer beams (lower) */}
      {[-6.5, 6.5].map((x, i) => (
        <mesh key={`fb-${i}`} position={[x, 2.9, 0]} castShadow>
          <boxGeometry args={[0.12, 0.12, FLOOR_SIZE]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}
      {[-7, 7].map((z, i) => (
        <mesh key={`lr-${i}`} position={[0, 2.9, z]} castShadow>
          <boxGeometry args={[FLOOR_SIZE, 0.12, 0.12]} />
          <meshStandardMaterial color={TEAK_DARK} />
        </mesh>
      ))}

      {/* Roof removed — open top for isometric camera view */}
    </group>
  );
}

function Walls() {
  // Joglo is open-sided (pendopo), but we add partial back walls
  return (
    <group>
      {/* Back wall (partial - represents dalem/inner house) */}
      <mesh position={[0, 1.5, -7.5]} receiveShadow>
        <boxGeometry args={[8, 3, 0.15]} />
        <meshStandardMaterial color="#5D4037" roughness={0.8} />
      </mesh>
      {/* Carved panel on back wall */}
      <mesh position={[0, 1.8, -7.42]}>
        <boxGeometry args={[3, 1.5, 0.02]} />
        <meshStandardMaterial color={TEAK_DARK} />
      </mesh>
      {/* Gold carving accents */}
      <mesh position={[0, 2.3, -7.4]}>
        <boxGeometry args={[2.5, 0.04, 0.01]} />
        <meshStandardMaterial color="#DAA520" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.3, -7.4]}>
        <boxGeometry args={[2.5, 0.04, 0.01]} />
        <meshStandardMaterial color="#DAA520" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Low wall / railing on sides (pendopo style) */}
      <mesh position={[-7.5, 0.3, 0]} receiveShadow>
        <boxGeometry args={[0.12, 0.6, FLOOR_SIZE]} />
        <meshStandardMaterial color="#6D4C3B" roughness={0.8} />
      </mesh>
      <mesh position={[7.5, 0.3, 0]} receiveShadow>
        <boxGeometry args={[0.12, 0.6, FLOOR_SIZE]} />
        <meshStandardMaterial color="#6D4C3B" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function Room() {
  return (
    <group>
      <Floor />
      <Walls />
      <JogloRoof />

      {/* ── 4 Saka Guru (Central Pillars) ── */}
      <SakaGuru position={[-2.5, 0, -3]} height={3.5} />
      <SakaGuru position={[2.5, 0, -3]} height={3.5} />
      <SakaGuru position={[-2.5, 0, 3]} height={3.5} />
      <SakaGuru position={[2.5, 0, 3]} height={3.5} />

      {/* ── Outer Pillars ── */}
      <Pillar position={[-6.5, 0, -5.5]} />
      <Pillar position={[-6.5, 0, 0]} />
      <Pillar position={[-6.5, 0, 5.5]} />
      <Pillar position={[6.5, 0, -5.5]} />
      <Pillar position={[6.5, 0, 0]} />
      <Pillar position={[6.5, 0, 5.5]} />

      {/* ── Work Area (back — near dalem) ── */}
      <WorkDesk position={[-4.5, 0, -6]} rotation={0} />
      <WorkDesk position={[-1.5, 0, -6]} rotation={0} />
      <WorkDesk position={[1.5, 0, -6]} rotation={0} />
      <WorkDesk position={[4.5, 0, -6]} rotation={0} />

      {/* ── Seating Area (center pendopo) ── */}
      <WoodenBench position={[-4, 0, 0]} rotation={Math.PI / 2} width={2} />
      <WoodenBench position={[4, 0, 0]} rotation={-Math.PI / 2} width={2} />
      <LowTable position={[0, 0, 0]} />

      {/* ── Tikar (woven mats) ── */}
      <Tikar position={[0, 0, 0]} size={[3, 2.5]} />
      <Tikar position={[-5, 0, 3]} size={[2, 1.5]} color="#B8956E" />

      {/* ── Gamelan ── */}
      <GamelanSet position={[4, 0, 4]} rotation={-Math.PI / 2} />

      {/* ── Decorations ── */}
      <BatikHanging position={[-7.4, 1.8, -2.5]} rotation={Math.PI / 2} color="#1B3A5C" />
      <BatikHanging position={[-7.4, 1.8, 2.5]} rotation={Math.PI / 2} color="#8B1A1A" />

      <KerisDisplay position={[0, 0.78, -7.35]} />
      <KerisDisplay position={[-1.2, 0.78, -7.35]} />
      <KerisDisplay position={[1.2, 0.78, -7.35]} />

      {/* ── Plants ── */}
      <TropicalPlant position={[-7, 0, -6.5]} />
      <TropicalPlant position={[7, 0, -6.5]} />
      <TropicalPlant position={[-7, 0, 6]} />
      <TropicalPlant position={[7, 0, 6]} />

      {/* ── Lanterns ── */}
      <HangingLantern position={[-2.5, 4.5, 0]} />
      <HangingLantern position={[2.5, 4.5, 0]} />
      <HangingLantern position={[0, 4.5, -3]} />
      <HangingLantern position={[0, 4.5, 3]} />

      {/* ── Extra bench at front ── */}
      <WoodenBench position={[0, 0, 5.5]} width={2.5} />
    </group>
  );
}
