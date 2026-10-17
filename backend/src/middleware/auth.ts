import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/client.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      req.session.destroy(() => undefined);
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    res.locals.userId = user.id;
    next();
  } catch (error) {
    next(error);
  }
}
