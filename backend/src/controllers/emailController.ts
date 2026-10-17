import { EmailStatus } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { listEmails, queryEmails, scheduleEmails } from "../services/emailService.js";
import { listSenders } from "../services/senderService.js";

export async function schedule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await scheduleEmails(res.locals.userId, req.body);
    res.status(201).json({ count: result.count, data: result.emails.map(({ id }) => ({ id })) });
  } catch (error) {
    next(error);
  }
}

function handleList(status: EmailStatus) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await listEmails(res.locals.userId, status, req.query));
    } catch (error) {
      next(error);
    }
  };
}

export const scheduled = handleList(EmailStatus.scheduled);
export const sent = handleList(EmailStatus.sent);
export function senders(_req: Request, res: Response): void {
  res.json({ data: listSenders() });
}

const searchQuerySchema = z.object({
  q: z.string().max(500).default(""),
  status: z.nativeEnum(EmailStatus).optional(),
  sender: z.string().email().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const options = searchQuerySchema.parse(req.query);
    const result = await queryEmails(res.locals.userId, options);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
