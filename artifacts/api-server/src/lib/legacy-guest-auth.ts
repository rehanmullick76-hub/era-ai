import type { Request, Response } from "express";

export function rejectLegacyGuestAuthentication(_req: Request, res: Response): void {
  res.status(410).json({ error: "Guest sessions are disabled. Please sign in." });
}
