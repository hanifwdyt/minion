import { z } from "zod";
import { Request, Response, NextFunction } from "express";

// --- Schemas ---

export const minionUpdateSchema = z.object({
  allowedTools: z.string().min(1, "allowedTools cannot be empty").optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
  model: z.string().max(100).optional(),
  workdir: z.string().min(1).max(500).optional(),
  name: z.string().min(1).max(50).optional(),
  role: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

export const soulUpdateSchema = z.object({
  content: z.string().max(10240, "Soul content max 10KB"),
});

export const sharedContextSchema = z.object({
  content: z.string().max(20480, "Shared context max 20KB"),
});

export const integrationSchema = z.object({
  telegram: z.object({
    enabled: z.boolean(),
    token: z.string().max(200),
  }).optional(),
  slack: z.object({
    enabled: z.boolean(),
    botToken: z.string().max(200),
    signingSecret: z.string().max(200),
    appToken: z.string().max(200),
  }).optional(),
  webhook: z.object({
    enabled: z.boolean(),
    secret: z.string().max(200),
  }).optional(),
  github: z.object({
    enabled: z.boolean(),
    webhookSecret: z.string().max(200),
    defaultReviewer: z.string().max(50),
    repos: z.array(z.string().max(200)),
  }).optional(),
  gitlab: z.object({
    enabled: z.boolean(),
    webhookSecret: z.string().max(200),
    instanceURL: z.string().max(500),
    apiToken: z.string().max(200),
    defaultReviewer: z.string().max(50),
    mode: z.enum(["webhook", "poll", "both"]),
    projects: z.array(z.string().max(200)),
  }).optional(),
}).strict();

export const promptSchema = z.object({
  minionId: z.string().min(1).max(50),
  prompt: z.string().min(1).max(50000, "Prompt max 50KB"),
});

// --- Middleware ---

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return res.status(400).json({ error: "Validation failed", details: errors });
    }
    req.body = result.data;
    next();
  };
}
