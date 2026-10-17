import { prisma } from "./db/client.js";
import { createRedisConnection } from "./queues/connection.js";
import { createEmailWorker } from "./workers/emailWorker.js";
import { initializeSenders } from "./services/senderService.js";
import { assertProductionConfiguration } from "./config/env.js";

const redis = createRedisConnection();
let worker: ReturnType<typeof createEmailWorker> | undefined;

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; closing worker connections.`);
  await worker?.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function start(): Promise<void> {
  assertProductionConfiguration();
  await prisma.$connect();
  await redis.ping();
  await initializeSenders();
  worker = createEmailWorker();
  console.info("Email worker started.");
}

start().catch(async (error: unknown) => {
  console.error("Email worker startup failed.", error);
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  process.exitCode = 1;
});
