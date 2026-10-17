import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export function requireQueueAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.QUEUE_ADMIN_ENABLED) {
    res.status(404).end();
    return;
  }
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Queue dashboard"');
    res.status(401).end();
    return;
  }
  let credentials: string;
  try {
    credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    res.status(401).end();
    return;
  }
  const [username, ...passwordParts] = credentials.split(":");
  const password = passwordParts.join(":");
  const suppliedUser = Buffer.from(username ?? "");
  const suppliedPassword = Buffer.from(password);
  const expectedUser = Buffer.from(env.QUEUE_ADMIN_USERNAME);
  const expectedPassword = Buffer.from(env.QUEUE_ADMIN_PASSWORD);
  const userMatches = suppliedUser.length === expectedUser.length && timingSafeEqual(suppliedUser, expectedUser);
  const passwordMatches = suppliedPassword.length === expectedPassword.length
    && timingSafeEqual(suppliedPassword, expectedPassword);
  if (userMatches && passwordMatches) {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Queue dashboard"');
  res.status(401).end();
}
