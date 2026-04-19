module.exports = {
  apps: [
    {
      name: "punakawan",
      script: "packages/server/dist/index.js",
      cwd: "/root/minion",
      node_args: "--env-file=/root/minion/.env",
      restart_delay: 1000,
      max_restarts: 5,
    },
  ],
};
