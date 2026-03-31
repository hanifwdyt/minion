import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ClaudeManager } from "./claude.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load minion config
const configPath = resolve(__dirname, "../minions.json");
const minionConfigs = JSON.parse(readFileSync(configPath, "utf-8"));

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173"],
    methods: ["GET", "POST"],
  },
});

const claude = new ClaudeManager();

// Forward Claude events to Socket.IO
claude.on("output", (data) => {
  io.emit("minion:output", data);
});

claude.on("status", (data) => {
  io.emit("minion:status", data);
});

claude.on("done", (data) => {
  io.emit("minion:done", data);
});

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);

  // Send minion list with current status
  const minions = minionConfigs.map((m: any) => ({
    ...m,
    status: claude.getStatus(m.id),
  }));
  socket.emit("minions:list", minions);

  // Handle prompt
  socket.on("minion:prompt", ({ minionId, prompt }) => {
    const config = minionConfigs.find((m: any) => m.id === minionId);
    if (!config) {
      socket.emit("minion:output", {
        minionId,
        data: `\x1b[31mError: Unknown minion "${minionId}"\x1b[0m\n`,
      });
      return;
    }

    console.log(`[ws] prompt for ${minionId}: ${prompt.slice(0, 80)}...`);
    const workdir = resolve(config.workdir);
    claude.runPrompt(minionId, prompt, workdir);
  });

  // Handle stop
  socket.on("minion:stop", ({ minionId }) => {
    console.log(`[ws] stop ${minionId}`);
    claude.stop(minionId);
  });

  socket.on("disconnect", () => {
    console.log(`[ws] client disconnected: ${socket.id}`);
  });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`\n  🤖 Minion Server running on http://localhost:${PORT}`);
  console.log(`  📦 ${minionConfigs.length} minions loaded\n`);
});
