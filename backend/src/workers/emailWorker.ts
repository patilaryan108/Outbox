import { EmailStatus, Prisma, type Email } from "@prisma/client";
import { DelayedError, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { createRedisConnection, redis } from "../queues/connection.js";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "../queues/emailQueue.js";
import { indexEmail } from "../services/searchService.js";
import { sendEmail } from "../services/senderService.js";
import { hasSlackConnection, notifySlackLimit } from "../services/slackService.js";
import { getRateLimitDelay, getUtcHourWindow } from "../utils/hourWindow.js";

const reserveSendSlotScript = `
local reserved = redis.call('GET', KEYS[2])
if reserved then return tonumber(reserved) end
local now = tonumber(ARGV[1])
local spacing = tonumber(ARGV[2])
local nextSlot = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, nextSlot)
redis.call('SET', KEYS[1], slot + spacing, 'PX', 86400000)
redis.call('SET', KEYS[2], slot, 'PX', 86400000)
return slot
`;

async function reserveSendSlot(email: Email): Promise<number> {
  const slot = await redis.eval(
    reserveSendSlotScript,
    2,
    `email-scheduler:send-slot:${email.sender}`,
    `email-scheduler:reserved-slot:${email.id}`,
    Date.now(),
    env.MIN_DELAY_BETWEEN_EMAILS_MS,
  );
  return Number(slot);
}

async function incrementRateCounter(
  sender: string,
  windowKey: string,
  ttl: number,
  limit: number,
): Promise<boolean> {
  const result = await redis.eval(
    `local count = tonumber(redis.call('GET', KEYS[1]) or '0')
     if count >= tonumber(ARGV[1]) then return 0 end
     count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
     return 1`,
    1,
    `rate:${sender}:${windowKey}`,
    limit,
    ttl,
  );
  return Number(result) === 1;
}

async function alertRateLimitOnce(
  email: Email,
  windowKey: string,
  label: string,
  limit: number,
): Promise<void> {
  const key = `slack-alert:${email.sender}:${windowKey}`;
  let acquired = false;
  try {
    acquired = (await redis.set(key, "sending", "EX", 7200, "NX")) === "OK";
    if (!acquired) return;
    if (!(await hasSlackConnection(email.userId))) {
      await redis.set(key, "no-connection", "EX", 60);
      return;
    }
    await notifySlackLimit(email.userId, email.sender, label, limit);
    await redis.set(key, "sent", "EX", 7200);
  } catch (error) {
    if (acquired) {
      await redis.del(key).catch((cleanupError: unknown) => {
        console.error("Could not release the Slack alert de-duplication lock.", cleanupError);
      });
    }
    console.error("Slack hourly-limit notification failed.", error);
  }
}

async function markEmail(emailId: string, status: EmailStatus, error?: string): Promise<void> {
  const updated = await prisma.email.update({
    where: { id: emailId },
    data: {
      status,
      sentAt: status === EmailStatus.sent ? new Date() : null,
      error: error ?? null,
    },
  });
  try {
    await indexEmail(updated);
  } catch (indexError) {
    console.error("Elasticsearch status update failed; database remains authoritative.", indexError);
  }
}

async function processEmail(job: Job<EmailJobData>, token?: string): Promise<void> {
    const email = await prisma.email.findUnique({ where: { id: job.data.emailId } });
    if (!email || email.status !== EmailStatus.scheduled) return;

    const slot = await reserveSendSlot(email);
    if (slot > Date.now()) {
      if (!token) throw new Error("BullMQ lock token is required to defer a send slot.");
      await job.moveToDelayed(slot, token);
      throw new DelayedError();
    }

    const now = new Date();
    const window = getUtcHourWindow(now);
    const limit = email.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const permitted = await incrementRateCounter(email.sender, window.key, window.ttl, limit);
    if (!permitted) {
      await alertRateLimitOnce(email, window.key, window.label, limit);
      if (!token) throw new Error("BullMQ lock token is required to defer a rate-limited email.");
      await job.moveToDelayed(getRateLimitDelay(window.nextHour, email.sequence), token);
      throw new DelayedError();
    }

    const claimed = await prisma.$queryRaw<Email[]>(Prisma.sql`
      UPDATE "Email"
      SET "status" = 'processing'::"EmailStatus",
          "attempts" = "attempts" + 1,
          "updatedAt" = NOW()
      WHERE "id" = ${email.id} AND "status" = 'scheduled'::"EmailStatus"
      RETURNING *
    `);
    const claimedEmail = claimed[0];
    if (!claimedEmail) return;

    try {
      const previewUrl = await sendEmail(claimedEmail);
      await markEmail(claimedEmail.id, EmailStatus.sent);
      if (previewUrl) console.info(`Ethereal preview for ${claimedEmail.id}: ${previewUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SMTP delivery error";
      await markEmail(claimedEmail.id, EmailStatus.failed, message);
      console.error(`Email ${claimedEmail.id} failed during its single delivery attempt.`, error);
    }
}

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmail, {
    connection: createRedisConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    autorun: true,
  });
  worker.on("failed", (job, error) => {
    console.error(`Queue job ${job?.id ?? "unknown"} failed.`, error);
  });
  worker.on("error", (error) => {
    console.error("Email worker error.", error);
  });
  return worker;
}
