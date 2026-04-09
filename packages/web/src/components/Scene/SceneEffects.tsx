import { useRef, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "../../store";
import { getMinionPositions } from "./Minion";

// ─── Particle burst when minion finishes task ───────────────
export function MinionParticles() {
  const { minions } = useStore();
  const [bursts, setBursts] = useState<{ id: string; position: THREE.Vector3; color: string; type: "done" | "error"; time: number }[]>([]);
  const prevStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const m of minions) {
      const prev = prevStatuses.current[m.id];
      if (prev === "working" && m.status === "idle") {
        // Done! Gold sparkle
        const pos = getMinionPositions().get(m.id);
        if (pos) {
          setBursts((b) => [...b, { id: `${m.id}-${Date.now()}`, position: pos.clone(), color: m.color, type: "done", time: Date.now() }]);
        }
      } else if (m.status === "error") {
        const pos = getMinionPositions().get(m.id);
        if (pos) {
          setBursts((b) => [...b, { id: `${m.id}-${Date.now()}`, position: pos.clone(), color: "#E53935", type: "error", time: Date.now() }]);
        }
      }
      prevStatuses.current[m.id] = m.status;
    }
  }, [minions]);

  // Clean up old bursts
  useEffect(() => {
    const iv = setInterval(() => {
      setBursts((b) => b.filter((burst) => Date.now() - burst.time < 3000));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      {bursts.map((burst) => (
        <ParticleBurst key={burst.id} position={burst.position} color={burst.color} type={burst.type} />
      ))}
    </>
  );
}

function ParticleBurst({ position, color, type }: { position: THREE.Vector3; color: string; type: "done" | "error" }) {
  const pointsRef = useRef<THREE.Points>(null);
  const startTime = useRef(Date.now());
  const count = type === "done" ? 20 : 12;

  const velocities = useRef(
    Array.from({ length: count }, () => new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 3 + 1,
      (Math.random() - 0.5) * 2,
    ))
  );

  const positions = useRef(new Float32Array(count * 3));
  const bufferAttrRef = useRef<THREE.BufferAttribute | null>(null);

  useFrame(() => {
    if (!pointsRef.current) return;
    const elapsed = (Date.now() - startTime.current) / 1000;
    if (elapsed > 2.5) return;

    const posArr = positions.current;

    for (let i = 0; i < count; i++) {
      const v = velocities.current[i];
      posArr[i * 3] = v.x * elapsed * 0.5;
      posArr[i * 3 + 1] = v.y * elapsed - 2 * elapsed * elapsed; // gravity
      posArr[i * 3 + 2] = v.z * elapsed * 0.5;
    }

    // Reuse BufferAttribute instead of creating new one every frame
    const geo = pointsRef.current.geometry;
    if (!bufferAttrRef.current) {
      bufferAttrRef.current = new THREE.BufferAttribute(posArr, 3);
      geo.setAttribute("position", bufferAttrRef.current);
    }
    bufferAttrRef.current.needsUpdate = true;

    const mat = pointsRef.current.material as THREE.PointsMaterial;
    mat.opacity = Math.max(0, 1 - elapsed / 2.5);
  });

  return (
    <points ref={pointsRef} position={position}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions.current, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={type === "done" ? "#FFD700" : color}
        size={type === "done" ? 0.08 : 0.12}
        transparent
        opacity={1}
        sizeAttenuation
      />
    </points>
  );
}

// ─── Day/Night Cycle ────────────────────────────────────────
// Pre-allocated colors for day/night cycle (avoid GC in useFrame)
const _ambientColor = new THREE.Color();
const _sunColor = new THREE.Color();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

export function DayNightCycle() {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;

    let intensity: number;

    if (hours >= 6 && hours < 10) {
      const t = (hours - 6) / 4;
      intensity = 0.3 + t * 0.7;
      _ambientColor.set("#FFF8E1").lerp(_c1.set("#FFFDE7"), t);
      _sunColor.set("#FFCC80").lerp(_c2.set("#FFF3E0"), t);
    } else if (hours >= 10 && hours < 16) {
      intensity = 1.0;
      _ambientColor.set("#FFFDE7");
      _sunColor.set("#FFF3E0");
    } else if (hours >= 16 && hours < 19) {
      const t = (hours - 16) / 3;
      intensity = 1.0 - t * 0.4;
      _ambientColor.set("#FFFDE7").lerp(_c1.set("#FFE0B2"), t);
      _sunColor.set("#FFF3E0").lerp(_c2.set("#FF8A65"), t);
    } else if (hours >= 19 && hours < 21) {
      const t = (hours - 19) / 2;
      intensity = 0.6 - t * 0.3;
      _ambientColor.set("#FFE0B2").lerp(_c1.set("#B0BEC5"), t);
      _sunColor.set("#FF8A65").lerp(_c2.set("#90A4AE"), t);
    } else {
      intensity = 0.3;
      _ambientColor.set("#B0BEC5");
      _sunColor.set("#90A4AE");
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = intensity * 0.4;
      ambientRef.current.color.copy(_ambientColor);
    }
    if (sunRef.current) {
      sunRef.current.intensity = intensity;
      sunRef.current.color.copy(_sunColor);
    }
    if (fillRef.current) {
      fillRef.current.intensity = intensity * 0.2;
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.4} color="#FFF8E1" />
      <directionalLight
        ref={sunRef}
        position={[10, 15, 8]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        color="#FFF3E0"
      />
      <directionalLight ref={fillRef} position={[-8, 8, -5]} intensity={0.2} color="#FFE0B2" />
    </>
  );
}
