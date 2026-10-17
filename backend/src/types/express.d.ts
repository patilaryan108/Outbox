import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    oauthState?: string;
  }
}

declare global {
  namespace Express {
    interface Locals {
      userId: string;
    }
  }
}
