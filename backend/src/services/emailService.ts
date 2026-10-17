import { EmailStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { emailQueue } from "../queues/emailQueue.js";
import { ensureSearchIndex, indexEmails, searchEmails } from "./searchService.js";
import { listSenders } from "./senderService.js";

export const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(100_000),
  recipients: z.array(z.string().trim().email()).min(1).max(env.MAX_SCHEDULE_BATCH_SIZE),
  startTime: z.string().datetime({ offset: true }),
  delayBetweenEmails: z.number().finite().min(0).max(86400),
  hourlyLimit: z.number().int().positive().optional(),
  sender: z.string().email().optional(),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;
const emailListSelect = {
  id: true,
  sender: true,
  recipient: true,
  subject: true,
  scheduledAt: true,
  sentAt: true,
  updatedAt: true,
  status: true,
  attempts: true,
  error: true,
} satisfies Prisma.EmailSelect;

const pageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function scheduleEmails(userId: string, rawInput: unknown) {
  const input = scheduleSchema.parse(rawInput);
  const availableSenders = listSenders();
  const sender = input.sender;
  if (sender && !availableSenders.includes(sender)) {
    throw new Error("The selected sender is not configured.");
  }
  if (!availableSenders.length) throw new Error("No email senders are configured.");
  const recipients = [...new Set(input.recipients.map((recipient) => recipient.toLowerCase()))];
  if (recipients.length === 0) throw new Error("At least one unique recipient is required.");
  const start = new Date(input.startTime);
  const createdAt = new Date();
  const emails = await prisma.email.createManyAndReturn({
    data: recipients.map((recipient, index) => {
      const id = randomUUID();
      return {
        id,
        userId,
        sender: sender ?? availableSenders[index % availableSenders.length]!,
        recipient,
        subject: input.subject,
        body: input.body,
        scheduledAt: new Date(start.getTime() + index * input.delayBetweenEmails * 1000),
        sequence: index,
        hourlyLimit: input.hourlyLimit,
        jobId: id,
        createdAt,
        updatedAt: createdAt,
      };
    }),
  });
  emails.sort((left, right) => left.sequence - right.sequence);

  const now = Date.now();
  await emailQueue.addBulk(emails.map((email) => ({
    name: "send-email",
    data: { emailId: email.id },
    opts: {
      jobId: email.jobId,
      delay: Math.max(0, email.scheduledAt.getTime() - now),
    },
  })));
  try {
    await indexEmails(emails);
  } catch (error) {
    console.error("Elasticsearch indexing failed; database remains authoritative.", error);
  }
  return { emails, count: emails.length };
}

export async function listEmails(userId: string, status: EmailStatus, query: unknown) {
  const { page, pageSize } = pageSchema.parse(query);
  const where: Prisma.EmailWhereInput = {
    userId,
    status: status === EmailStatus.scheduled
      ? { in: [EmailStatus.scheduled, EmailStatus.processing] }
      : { in: [EmailStatus.sent, EmailStatus.failed] },
  };
  const [data, total] = await prisma.$transaction([
    prisma.email.findMany({
      where,
      select: emailListSelect,
      orderBy: status === EmailStatus.scheduled
        ? [{ scheduledAt: "asc" }, { sequence: "asc" }]
        : [{ sentAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.email.count({ where }),
  ]);
  return { data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function queryEmails(
  userId: string,
  options: { q: string; status?: EmailStatus; sender?: string; page: number; pageSize: number },
) {
  try {
    const results = await searchEmails(userId, options.q, options.status, options.sender, options.page, options.pageSize);
    if (!results.hits.length) return { data: [], page: options.page, pageSize: options.pageSize, total: results.total };
    const ids = results.hits.map((hit) => hit.id);
    const rows = await prisma.email.findMany({
      where: { userId, id: { in: ids } },
      select: emailListSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      data: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      }),
      page: options.page,
      pageSize: options.pageSize,
      total: results.total,
    };
  } catch (error) {
    console.error("Elasticsearch is unavailable; falling back to PostgreSQL search.", error);
    const where: Prisma.EmailWhereInput = {
      userId,
      ...(options.status
        ? {
            status: options.status === EmailStatus.scheduled
              ? { in: [EmailStatus.scheduled, EmailStatus.processing] }
              : options.status === EmailStatus.sent
                ? { in: [EmailStatus.sent, EmailStatus.failed] }
              : options.status,
          }
        : {}),
      ...(options.sender ? { sender: options.sender } : {}),
      OR: [
        { subject: { contains: options.q, mode: "insensitive" } },
        { body: { contains: options.q, mode: "insensitive" } },
        { recipient: { contains: options.q, mode: "insensitive" } },
      ],
    };
    const [data, total] = await prisma.$transaction([
      prisma.email.findMany({
        where,
        select: emailListSelect,
        orderBy: { scheduledAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      prisma.email.count({ where }),
    ]);
    return { data, page: options.page, pageSize: options.pageSize, total, degraded: true };
  }
}

export async function reindexAllEmails(): Promise<void> {
  try {
    await ensureSearchIndex();
  } catch (error) {
    console.error("Elasticsearch is unavailable; skipping startup reindex.", error);
    return;
  }
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.email.findMany({
      where: { status: { in: [EmailStatus.scheduled, EmailStatus.processing, EmailStatus.sent, EmailStatus.failed] } },
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (!batch.length) break;
    try {
      await indexEmails(batch);
    } catch (error) {
      console.error("Elasticsearch reindex batch failed; database remains authoritative.", error);
    }
    cursor = batch[batch.length - 1]!.id;
  }
}

export async function reconcileQueue(): Promise<number> {
  let cursor: string | undefined;
  let requeued = 0;
  while (true) {
    const rows = await prisma.email.findMany({
      where: { status: EmailStatus.scheduled },
      take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    if (!rows.length) break;
    for (const email of rows) {
      const existing = await emailQueue.getJob(email.jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") await existing.remove();
        else continue;
      }
      await emailQueue.add("send-email", { emailId: email.id }, {
        jobId: email.jobId,
        delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
      });
      requeued += 1;
    }
    cursor = rows[rows.length - 1]!.id;
  }
  return requeued;
}
