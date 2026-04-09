import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import { getMinionPositions } from "./Minion";

export function IsometricCamera() {
  const { camera } = useThree();
  const { cameraMode, selectedMinionId } = useStore();
  const controlsRef = useRef<any>(null);
  const followTarget = useRef(new THREE.Vector3(0, 0, -2));

  useEffect(() => {
    if (cameraMode === "overview") {
      camera.position.set(12, 10, 12);
      camera.lookAt(0, 0, -2);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, -2);
      }
    }
  }, [camera, cameraMode]);

  // Follow selected minion
  useFrame(() => {
    if (cameraMode !== "follow" || !selectedMinionId || !controlsRef.current) return;

    const pos = getMinionPositions().get(selectedMinionId);
    if (!pos) return;

    // Smooth follow
    followTarget.current.lerp(pos, 0.05);
    controlsRef.current.target.copy(followTarget.current);
    controlsRef.current.target.y = 1;

    // Position camera relative to target
    const offset = new THREE.Vector3(5, 5, 5);
    const desiredPos = followTarget.current.clone().add(offset);
    camera.position.lerp(desiredPos, 0.05);
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={[0, 0, -2]}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 3}
      minDistance={cameraMode === "follow" ? 4 : 8}
      maxDistance={cameraMode === "follow" ? 12 : 25}
      enablePan={cameraMode === "overview"}
      enableDamping={true}
      dampingFactor={0.05}
      enableRotate={cameraMode === "overview"}
    />
  );
}
