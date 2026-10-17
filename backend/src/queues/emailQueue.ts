import { Queue } from "bullmq";
import { createRedisConnection } from "./connection.js";

export const EMAIL_QUEUE_NAME = "scheduled-emails";
export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 10000 },
    removeOnFail: { age: 60 * 60 * 24 * 30, count: 10000 },
  },
});
