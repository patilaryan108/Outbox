import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { env, assertConfiguredOAuth } from "../config/env.js";
import { prisma } from "../db/client.js";

let googleConfigured = false;
function configureGoogle(): void {
  assertConfiguredOAuth();
  if (googleConfigured) return;
  passport.use(new GoogleStrategy({
    clientID: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackURL: env.GOOGLE_CALLBACK_URL,
  }, async (_accessToken, _refreshToken, profile: Profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email) return done(new Error("Google did not provide an email address."));
      if (env.GOOGLE_ALLOWED_EMAIL_DOMAIN && !email.endsWith(`@${env.GOOGLE_ALLOWED_EMAIL_DOMAIN.toLowerCase()}`)) {
        return done(null, false, { message: "This Google account is not allowed." });
      }
      const user = await prisma.user.upsert({
        where: { googleId: profile.id },
        create: {
          googleId: profile.id,
          email,
          name: profile.displayName || email,
          avatarUrl: profile.photos?.[0]?.value,
        },
        update: {
          email,
          name: profile.displayName || email,
          avatarUrl: profile.photos?.[0]?.value,
        },
      });
      done(null, user);
    } catch (error) {
      done(error as Error);
    }
  }));
  googleConfigured = true;
}

export function googleLogin(req: Request, res: Response, next: NextFunction): void {
  try {
    configureGoogle();
    passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
  } catch (error) {
    next(error);
  }
}

export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  try {
    configureGoogle();
    passport.authenticate("google", { session: false }, (error: unknown, user: { id: string } | false) => {
      if (error) return next(error);
      if (!user) return res.redirect(`${env.FRONTEND_URL}/?login=failed`);
      req.session.regenerate((sessionError) => {
        if (sessionError) return next(sessionError);
        req.session.userId = user.id;
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          res.redirect(`${env.FRONTEND_URL}/dashboard`);
        });
      });
    })(req, res, next);
  } catch (error) {
    next(error);
  }
}

export async function currentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.session.userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

export function logout(req: Request, res: Response, next: NextFunction): void {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("email-scheduler.sid");
    res.status(204).end();
  });
}

export async function devLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (env.NODE_ENV !== "development") {
    res.status(404).end();
    return;
  }
  try {
    const user = await prisma.user.upsert({
      where: { googleId: "local-demo-user" },
      create: { googleId: "local-demo-user", email: env.DEMO_USER_EMAIL, name: "Demo User" },
      update: { email: env.DEMO_USER_EMAIL, name: "Demo User" },
    });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
      });
    });
  } catch (error) {
    next(error);
  }
}
