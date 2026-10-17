import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:5000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  ELASTICSEARCH_INDEX: z.string().default("emails"),
  SESSION_SECRET: z.string().min(16),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALLBACK_URL: z.string().url().default("http://localhost:5000/auth/google/callback"),
  GOOGLE_ALLOWED_EMAIL_DOMAIN: z.string().default(""),
  SLACK_CLIENT_ID: z.string().default(""),
  SLACK_CLIENT_SECRET: z.string().default(""),
  SLACK_CALLBACK_URL: z.string().url().default("http://localhost:5000/api/slack/callback"),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be 32 bytes encoded as 64 hex characters"),
  ETHEREAL_SENDER_COUNT: z.coerce.number().int().min(1).max(20).default(2),
  ETHEREAL_FROM_NAME: z.string().default("Email Scheduler"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().nonnegative().default(1000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(100),
  MAX_SCHEDULE_BATCH_SIZE: z.coerce.number().int().positive().max(10000).default(1000),
  QUEUE_ADMIN_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  QUEUE_ADMIN_USERNAME: z.string().default("admin"),
  QUEUE_ADMIN_PASSWORD: z.string().min(12).default("replace-this-password"),
  DEMO_USER_EMAIL: z.string().email().default("demo@example.com"),
});

export const env = envSchema.parse(process.env);

export function assertConfiguredOAuth(): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
}

export function assertConfiguredSlack(): void {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new Error("Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.");
  }
}

export function assertProductionConfiguration(): void {
  if (env.NODE_ENV !== "production") return;
  if (env.SESSION_SECRET === "replace-with-a-long-random-secret"
    || env.TOKEN_ENCRYPTION_KEY === "0".repeat(64)) {
    throw new Error("Production requires unique SESSION_SECRET and TOKEN_ENCRYPTION_KEY values.");
  }
  if (!env.COOKIE_SECURE || !env.FRONTEND_URL.startsWith("https://")
    || !env.API_PUBLIC_URL.startsWith("https://") || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Production requires HTTPS URLs, secure cookies, and configured Google OAuth credentials.");
  }
}
