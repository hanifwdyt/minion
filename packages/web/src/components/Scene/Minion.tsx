import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { MinionState } from "../../types";
import { useStore } from "../../store";

interface MinionProps {
  minion: MinionState;
}

export function Minion({ minion }: MinionProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const { selectedMinionId, selectMinion } = useStore();
  const isSelected = selectedMinionId === minion.id;
  const isWorking = minion.status === "working";

  // Animation
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();

    // Idle: gentle bobbing
    groupRef.current.position.y = Math.sin(t * 1.5) * 0.03;

    // Working: faster bobbing + slight rotation (typing)
    if (isWorking) {
      groupRef.current.position.y = Math.sin(t * 3) * 0.02;
      groupRef.current.rotation.y = Math.sin(t * 4) * 0.05;
    } else {
      groupRef.current.rotation.y = 0;
    }
  });

  const color = new THREE.Color(minion.color);
  const emissiveIntensity = hovered ? 0.4 : isSelected ? 0.3 : isWorking ? 0.2 : 0;

  return (
    <group
      position={minion.position}
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation();
        selectMinion(isSelected ? null : minion.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* Body */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.3]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial color="#ffd9b3" />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.08, 1.18, 0.18]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[0.08, 1.18, 0.18]}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      {/* Left arm */}
      <ArmAnimated side={-1} isWorking={isWorking} color={color} />
      {/* Right arm */}
      <ArmAnimated side={1} isWorking={isWorking} color={color} />

      {/* Left leg */}
      <mesh position={[-0.12, 0.2, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.2]} />
        <meshStandardMaterial color="#2d3436" />
      </mesh>
      {/* Right leg */}
      <mesh position={[0.12, 0.2, 0]} castShadow>
        <boxGeometry args={[0.15, 0.4, 0.2]} />
        <meshStandardMaterial color="#2d3436" />
      </mesh>

      {/* Floating label */}
      <Html
        position={[0, 1.7, 0]}
        center
        distanceFactor={8}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            background: isWorking
              ? "rgba(46, 213, 115, 0.9)"
              : "rgba(20, 20, 40, 0.85)",
            color: "white",
            padding: "4px 10px",
            borderRadius: "6px",
            fontSize: "11px",
            fontFamily: "Inter, sans-serif",
            textAlign: "center",
            whiteSpace: "nowrap",
            border: `1px solid ${minion.color}40`,
            backdropFilter: "blur(4px)",
          }}
        >
          <div style={{ fontWeight: 700 }}>{minion.name}</div>
          <div style={{ fontSize: "9px", opacity: 0.8 }}>{minion.role}</div>
        </div>
      </Html>

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.45, 0.55, 32]} />
          <meshBasicMaterial color={minion.color} transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

function ArmAnimated({
  side,
  isWorking,
  color,
}: {
  side: -1 | 1;
  isWorking: boolean;
  color: THREE.Color;
}) {
  const armRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!armRef.current) return;
    const t = clock.getElapsedTime();
    if (isWorking) {
      // Typing animation
      armRef.current.rotation.x = Math.sin(t * 6 + side) * 0.3 - 0.5;
    } else {
      armRef.current.rotation.x = 0;
    }
  });

  return (
    <mesh
      ref={armRef}
      position={[side * 0.35, 0.6, 0]}
      castShadow
    >
      <boxGeometry args={[0.12, 0.5, 0.15]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
