import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect } from "react";

export function IsometricCamera() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(12, 10, 12);
    camera.lookAt(0, 0, -2);
  }, [camera]);

  return (
    <OrbitControls
      target={[0, 0, -2]}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 3}
      minDistance={8}
      maxDistance={25}
      enablePan={true}
      enableDamping={true}
      dampingFactor={0.05}
    />
  );
}
