import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { assertConfiguredSlack, env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { disconnectSlack, getSlackOAuthConfig, saveSlackConnection } from "../services/slackService.js";

export async function connect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertConfiguredSlack();
    const state = randomBytes(24).toString("hex");
    req.session.oauthState = state;
    req.session.save((error) => {
      if (error) return next(error);
      const config = getSlackOAuthConfig();
      const query = new URLSearchParams({
        client_id: config.clientId,
        scope: "chat:write,incoming-webhook",
        redirect_uri: config.callbackUrl,
        state,
      });
      res.redirect(`https://slack.com/oauth/v2/authorize?${query.toString()}`);
    });
  } catch (error) {
    next(error);
  }
}

export async function callback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const state = req.query.state;
    const savedState = req.session.oauthState;
    delete req.session.oauthState;
    if (typeof state !== "string" || !savedState || state.length !== savedState.length
      || !timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) {
      res.status(400).json({ error: "Invalid Slack OAuth state." });
      return;
    }
    if (typeof req.query.code !== "string") {
      res.status(400).json({ error: "Slack authorization was not completed." });
      return;
    }
    const config = getSlackOAuthConfig();
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Slack OAuth token exchange failed with HTTP ${response.status}.`);
    const result = await response.json() as {
      ok?: boolean;
      error?: string;
      access_token: string;
      scope?: string;
      team?: { id?: string; name?: string };
      incoming_webhook?: { url?: string; channel_id?: string };
    };
    if (!result.ok) throw new Error(`Slack OAuth failed: ${result.error ?? "unknown error"}`);
    if (!req.session.userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    await saveSlackConnection(req.session.userId, result);
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (error) {
    next(error);
  }
}

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const connections = await prisma.slackConnection.findMany({
      where: { userId: res.locals.userId },
      select: { id: true, teamId: true, teamName: true, createdAt: true },
    });
    res.json({ connected: connections.length > 0, connections });
  } catch (error) {
    next(error);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await disconnectSlack(res.locals.userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}
