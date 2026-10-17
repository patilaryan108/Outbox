import app from "./app.js";
import { assertProductionConfiguration, env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { emailQueue } from "./queues/emailQueue.js";
import { reconcileQueue, reindexAllEmails } from "./services/emailService.js";
import { initializeSenders } from "./services/senderService.js";
import { redis } from "./queues/connection.js";

async function start(): Promise<void> {
  assertProductionConfiguration();
  if (env.QUEUE_ADMIN_ENABLED && env.QUEUE_ADMIN_PASSWORD === "replace-this-password") {
    throw new Error("Set a non-default QUEUE_ADMIN_PASSWORD before enabling the queue dashboard.");
  }
  await prisma.$connect();
  await redis.ping();
  await initializeSenders();
  await reindexAllEmails();
  const requeued = await reconcileQueue();
  if (requeued) console.info(`Reconciled ${requeued} scheduled email jobs.`);
  const server = app.listen(env.PORT, () => console.info(`API listening on port ${env.PORT}.`));

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}; shutting down API.`);
    server.close();
    await Promise.all([emailQueue.close(), redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

start().catch(async (error: unknown) => {
  console.error("API startup failed.", error);
  await Promise.allSettled([emailQueue.close(), redis.quit(), prisma.$disconnect()]);
  process.exitCode = 1;
});
