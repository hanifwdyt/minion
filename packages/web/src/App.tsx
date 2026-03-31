import { Canvas } from "@react-three/fiber";
import { Room } from "./components/Scene/Room";
import { Minion } from "./components/Scene/Minion";
import { IsometricCamera } from "./components/Scene/IsometricCamera";
import { SidePanel } from "./components/Panel/SidePanel";
import { TopBar } from "./components/UI/TopBar";
import { useSocket } from "./hooks/useSocket";
import { useStore } from "./store";

export default function App() {
  const { socket, sendPrompt, stopMinion } = useSocket();
  const { minions, selectMinion } = useStore();

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <TopBar />

      <Canvas
        shadows
        style={{ background: "#0a0a12" }}
        camera={{ position: [12, 10, 12], fov: 35 }}
        onPointerMissed={() => selectMinion(null)}
      >
        <ambientLight intensity={0.3} />
        <directionalLight
          position={[8, 12, 8]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
        />
        <pointLight position={[-4, 6, 2]} intensity={0.3} color="#7c3aed" />
        <pointLight position={[4, 6, -4]} intensity={0.2} color="#3498db" />

        <fog attach="fog" args={["#0a0a12", 15, 35]} />

        <IsometricCamera />
        <Room />

        {minions.map((minion) => (
          <Minion key={minion.id} minion={minion} />
        ))}
      </Canvas>

      <SidePanel
        socket={socket}
        onSendPrompt={sendPrompt}
        onStop={stopMinion}
      />
    </div>
  );
}
