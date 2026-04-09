import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
});

export function requestLogger() {
  let reqCounter = 0;
  return (req: any, res: any, next: any) => {
    const reqId = `req-${++reqCounter}`;
    req.reqId = reqId;
    const start = Date.now();
    res.on("finish", () => {
      logger.info({
        reqId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      }, `${req.method} ${req.path} ${res.statusCode}`);
    });
    next();
  };
}
