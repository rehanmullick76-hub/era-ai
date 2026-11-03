import { Request, Response, NextFunction } from "express";
import { ensureUser } from "../lib/credits";
import { getAuthenticatedSessionUser } from "../lib/auth-session";

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = await getAuthenticatedSessionUser(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized. Please sign in to continue." });
    return;
  }
  await ensureUser(userId);
  (req as any).userId = userId;
  res.setHeader("x-era-user-id", userId);
  next();
}
