import { Canvas } from "@react-three/fiber";
import { Room } from "./components/Scene/Room";
import { Minion } from "./components/Scene/Minion";
import { IsometricCamera } from "./components/Scene/IsometricCamera";
import { DayNightCycle, MinionParticles } from "./components/Scene/SceneEffects";
import { SidePanel } from "./components/Panel/SidePanel";
import { TopBar } from "./components/UI/TopBar";
import { ErrorBoundary } from "./components/UI/ErrorBoundary";
import { ActivityFeed } from "./components/Panel/ActivityFeed";
import { LoginScreen } from "./components/UI/LoginScreen";
import { lazy, Suspense } from "react";
const Dashboard = lazy(() => import("./components/Dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
import { AudioManager } from "./components/UI/AudioManager";
import { Toaster } from "./components/UI/Toaster";
import { useSocket } from "./hooks/useSocket";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNotifications } from "./hooks/useNotifications";
import { useStore } from "./store";

const START_POSITIONS: Record<string, [number, number]> = {
  semar: [-2, 1],
  gareng: [3, -2],
  petruk: [-4, 4],
  bagong: [2, 3],
};

export default function App() {
  const { sendPrompt, stopMinion, clearMinionChat } = useSocket();
  useKeyboardShortcuts();
  useNotifications();
  const { minions, selectMinion, activityEvents, activityOpen, setActivityOpen, dashboardOpen, setDashboardOpen, connected, isAuthenticated } = useStore();

  if (!isAuthenticated) return <LoginScreen />;

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      {/* Vignette overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(26, 20, 16, 0.45) 100%)",
        }}
      />

      <TopBar />
      <AudioManager />
      <Toaster />

      <ErrorBoundary label="3D Scene">
        <Canvas
          shadows
          style={{ background: "#1a1410" }}
          camera={{ position: [14, 11, 14], fov: 35 }}
          onPointerMissed={() => selectMinion(null)}
        >
          {/* Dynamic day/night lighting */}
          <DayNightCycle />

          <fog attach="fog" args={["#1a1410", 22, 45]} />
          <color attach="background" args={["#1a1410"]} />

          <IsometricCamera />
          <Room />

          {minions.map((minion) => (
            <Minion
              key={minion.id}
              minion={minion}
              startPosition={START_POSITIONS[minion.id] || [0, 0]}
            />
          ))}

          {/* Particle effects */}
          <MinionParticles />
        </Canvas>
      </ErrorBoundary>

      <ErrorBoundary label="Chat Panel">
        <SidePanel onSendPrompt={sendPrompt} onStop={stopMinion} onClearChat={clearMinionChat} />
      </ErrorBoundary>

      <ActivityFeed
        events={activityEvents}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />

      {dashboardOpen && (
        <Suspense fallback={<div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(26, 20, 16, 0.8)",
          backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#C8A35A",
          fontSize: 16,
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontStyle: "italic",
        }}>Loading dashboard...</div>}>
          <Dashboard onClose={() => setDashboardOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
