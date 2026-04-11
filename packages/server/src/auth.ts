import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { ConfigStore } from "./config-store.js";
import { logger } from "./logger.js";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

function isDefaultCredentials(authConfig: { adminUser: string; adminPass: string }): boolean {
  return authConfig.adminUser === "admin" && authConfig.adminPass === "admin";
}

export function setupAuth(app: any, configStore: ConfigStore) {
  // Status — apakah sudah ada akun terdaftar
  app.get("/api/auth/status", (_req: Request, res: Response) => {
    const authConfig = configStore.getAuth();
    const hasAccount = authConfig.enabled && !isDefaultCredentials(authConfig);
    res.json({ hasAccount, authEnabled: authConfig.enabled });
  });

  // Register — hanya boleh kalau belum ada akun (auth disabled atau masih default)
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const authConfig = configStore.getAuth();
    if (authConfig.enabled && !isDefaultCredentials(authConfig)) {
      return res.status(403).json({ error: "Account already exists" });
    }

    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const hashed = await hashPassword(password);
    const jwtSecret = authConfig.jwtSecret === "minion-secret-change-me"
      ? randomBytes(32).toString("hex")
      : authConfig.jwtSecret;

    configStore.updateAuth({
      enabled: true,
      adminUser: email,
      adminPass: hashed,
      jwtSecret,
    });

    const token = jwt.sign({ user: email, name, role: "admin" }, jwtSecret, { expiresIn: "8h" });
    logger.info({ user: email }, "Registration successful");
    res.json({ token, user: email, name });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const authConfig = configStore.getAuth();
    if (!authConfig.enabled) {
      return res.json({ token: "auth-disabled", user: "anonymous" });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const validUser = username === authConfig.adminUser;
    // Support both hashed and plain passwords (migration)
    let validPass = false;
    if (authConfig.adminPass.startsWith("$2b$") || authConfig.adminPass.startsWith("$2a$")) {
      validPass = await bcrypt.compare(password, authConfig.adminPass);
    } else {
      validPass = password === authConfig.adminPass;
      // Auto-hash on first successful login with plain password
      if (validUser && validPass) {
        const hashed = await hashPassword(password);
        configStore.updateAuth({ adminPass: hashed });
        logger.info("Auto-hashed admin password on first login");
      }
    }

    if (validUser && validPass) {
      const token = jwt.sign(
        { user: username, role: "admin" },
        authConfig.jwtSecret,
        { expiresIn: "8h" }
      );
      logger.info({ user: username }, "Login successful");
      return res.json({ token, user: username });
    }

    logger.warn({ user: username }, "Login failed");
    res.status(401).json({ error: "Invalid credentials" });
  });

  app.get("/api/auth/verify", authMiddleware(configStore), (_req: Request, res: Response) => {
    res.json({ valid: true, user: (_req as any).user });
  });
}

export function authMiddleware(configStore: ConfigStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authConfig = configStore.getAuth();
    if (!authConfig.enabled) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    try {
      const decoded = jwt.verify(authHeader.slice(7), authConfig.jwtSecret);
      (req as any).user = decoded;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
