import { useRef } from "react";
import * as THREE from "three";

const FLOOR_SIZE = 16;
const WALL_HEIGHT = 4;
const WALL_THICKNESS = 0.15;

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
    </mesh>
  );
}

function Walls() {
  const wallColor = "#16213e";
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, WALL_HEIGHT / 2, -FLOOR_SIZE / 2]} receiveShadow>
        <boxGeometry args={[FLOOR_SIZE, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-FLOOR_SIZE / 2, WALL_HEIGHT / 2, 0]} receiveShadow>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
    </group>
  );
}

function Desk({ position }: { position: [number, number, number] }) {
  const deskColor = "#2d3436";
  const legColor = "#636e72";
  const tableTop = 0.9;
  const tableWidth = 1.8;
  const tableDepth = 0.9;

  return (
    <group position={position}>
      {/* Table top */}
      <mesh position={[0, tableTop, 0]} castShadow receiveShadow>
        <boxGeometry args={[tableWidth, 0.06, tableDepth]} />
        <meshStandardMaterial color={deskColor} />
      </mesh>
      {/* Legs */}
      {[
        [-0.8, 0.45, -0.35],
        [0.8, 0.45, -0.35],
        [-0.8, 0.45, 0.35],
        [0.8, 0.45, 0.35],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.05, 0.9, 0.05]} />
          <meshStandardMaterial color={legColor} />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 1.4, -0.25]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.04]} />
        <meshStandardMaterial color="#0f0f23" emissive="#1a1a3e" emissiveIntensity={0.3} />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 1.1, -0.25]} castShadow>
        <boxGeometry args={[0.06, 0.2, 0.06]} />
        <meshStandardMaterial color={legColor} />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 0.94, 0.1]}>
        <boxGeometry args={[0.5, 0.02, 0.18]} />
        <meshStandardMaterial color="#2d2d2d" />
      </mesh>
    </group>
  );
}

function GridFloor() {
  const gridRef = useRef<THREE.GridHelper>(null);
  return (
    <gridHelper
      ref={gridRef}
      args={[FLOOR_SIZE, 16, "#ffffff08", "#ffffff05"]}
      position={[0, 0.01, 0]}
    />
  );
}

export function Room() {
  return (
    <group>
      <Floor />
      <Walls />
      <GridFloor />

      {/* Row of desks */}
      <Desk position={[-3, 0, -4]} />
      <Desk position={[0, 0, -4]} />
      <Desk position={[3, 0, -4]} />
      <Desk position={[-3, 0, -1]} />
      <Desk position={[0, 0, -1]} />
      <Desk position={[3, 0, -1]} />
    </group>
  );
}
