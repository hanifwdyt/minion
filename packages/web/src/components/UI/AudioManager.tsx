import { useEffect, useRef } from "react";
import { useStore } from "../../store";

// Simple tone-based SFX using Web Audio API (no external audio files needed)
class SFXEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) { this.muted = m; }
  isMuted() { return this.muted; }

  // Notification ding — pleasant two-tone
  playDone() {
    if (this.muted) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    this.playTone(ctx, 523.25, now, 0.15, 0.12); // C5
    this.playTone(ctx, 659.25, now + 0.12, 0.2, 0.1); // E5
  }

  // Error gong — low rumble
  playError() {
    if (this.muted) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    this.playTone(ctx, 130.81, now, 0.5, 0.15, "triangle"); // C3
    this.playTone(ctx, 110, now + 0.1, 0.6, 0.12, "sawtooth"); // A2
  }

  // Typing click — subtle
  playTyping() {
    if (this.muted) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    this.playNoise(ctx, now, 0.03, 0.02);
  }

  private playTone(
    ctx: AudioContext, freq: number, start: number,
    duration: number, volume: number, type: OscillatorType = "sine"
  ) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }

  private playNoise(ctx: AudioContext, start: number, duration: number, volume: number) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4000;
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
  }
}

const sfx = new SFXEngine();

export function useAudio() {
  return sfx;
}

export function AudioManager() {
  const { minions } = useStore();
  const prevStatuses = useRef<Record<string, string>>({});
  const typingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const anyWorking = minions.some((m) => m.status === "working");

    for (const m of minions) {
      const prev = prevStatuses.current[m.id];
      if (prev === "working" && m.status === "idle") {
        sfx.playDone();
      } else if (m.status === "error" && prev !== "error") {
        sfx.playError();
      }
      prevStatuses.current[m.id] = m.status;
    }

    // Typing sounds while working
    if (anyWorking && !typingInterval.current) {
      typingInterval.current = setInterval(() => {
        sfx.playTyping();
      }, 200 + Math.random() * 300);
    } else if (!anyWorking && typingInterval.current) {
      clearInterval(typingInterval.current);
      typingInterval.current = null;
    }

    return () => {
      if (typingInterval.current) {
        clearInterval(typingInterval.current);
        typingInterval.current = null;
      }
    };
  }, [minions]);

  return null; // No UI — just side effects
}

export function MuteButton() {
  const { audioMuted, setAudioMuted } = useStore();

  return (
    <button
      onClick={() => {
        const next = !audioMuted;
        setAudioMuted(next);
        sfx.setMuted(next);
      }}
      title={audioMuted ? "Unmute" : "Mute"}
      style={{
        background: "rgba(255,255,255,0.1)",
        border: "2px solid transparent",
        borderRadius: "14px",
        padding: "3px 10px",
        cursor: "pointer",
        color: "#FFE0B2",
        fontSize: "14px",
        transition: "all 0.2s",
        opacity: audioMuted ? 0.5 : 1,
      }}
    >
      {audioMuted ? "🔇" : "🔊"}
    </button>
  );
}
