import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import passport from "passport";
import { env } from "./config/env.js";
import { emailQueue } from "./queues/emailQueue.js";
import authRoutes from "./routes/authRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import slackRoutes from "./routes/slackRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { RedisSessionStore } from "./middleware/redisSessionStore.js";
import { requireQueueAdmin } from "./middleware/queueAdminAuth.js";

const app = express();
if (env.NODE_ENV === "production") app.set("trust proxy", 1);
const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: boardAdapter,
});

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(session({
  name: "email-scheduler.sid",
  store: new RedisSessionStore(),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/slack", slackRoutes);
app.use("/admin/queues", requireQueueAdmin, boardAdapter.getRouter());
app.use(errorHandler);

export default app;
