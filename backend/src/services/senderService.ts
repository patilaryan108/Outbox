import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import type { SentMessageInfo } from "nodemailer";
import type { Email } from "@prisma/client";
import { env } from "../config/env.js";
import { redis } from "../queues/connection.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";

interface SenderAccount {
  email: string;
  user: string;
  pass: string;
}

const ACCOUNTS_KEY = "email-scheduler:ethereal-senders";
const ACCOUNTS_LOCK_KEY = "email-scheduler:ethereal-senders:init-lock";
let accounts: SenderAccount[] = [];
const transports = new Map<string, Transporter<SentMessageInfo>>();

export async function initializeSenders(): Promise<void> {
  let persisted = await redis.get(ACCOUNTS_KEY);
  if (!persisted) {
    const lockToken = randomUUID();
    const acquired = await redis.set(ACCOUNTS_LOCK_KEY, lockToken, "PX", 300_000, "NX");
    if (acquired === "OK") {
      try {
        persisted = await redis.get(ACCOUNTS_KEY);
        if (!persisted) {
          accounts = [];
          for (let i = 0; i < env.ETHEREAL_SENDER_COUNT; i += 1) {
            const account = await nodemailer.createTestAccount();
            accounts.push({ email: account.user, user: account.user, pass: account.pass });
          }
          if (accounts.length === 0) throw new Error("No Ethereal sender accounts were created.");
          persisted = encryptSecret(JSON.stringify(accounts));
          await redis.set(ACCOUNTS_KEY, persisted);
        }
      } finally {
        await redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          ACCOUNTS_LOCK_KEY,
          lockToken,
        );
      }
    } else {
      const deadline = Date.now() + 90_000;
      while (!persisted && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        persisted = await redis.get(ACCOUNTS_KEY);
      }
      if (!persisted) {
        throw new Error("Timed out waiting for the shared Ethereal sender pool to initialize.");
      }
    }
  }
  if (persisted) accounts = JSON.parse(decryptSecret(persisted)) as SenderAccount[];
  if (accounts.length === 0) throw new Error("No Ethereal sender accounts are configured.");
  for (const account of accounts) {
    transports.set(account.email, nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
    }));
  }
}

export function listSenders(): string[] {
  return accounts.map((account) => account.email);
}

export async function sendEmail(email: Email): Promise<string | undefined> {
  const transport = transports.get(email.sender);
  if (!transport) throw new Error(`No SMTP transport is available for sender ${email.sender}.`);
  const result = await transport.sendMail({
    from: `"${env.ETHEREAL_FROM_NAME}" <${email.sender}>`,
    to: email.recipient,
    subject: email.subject,
    text: email.body,
  });
  const previewUrl = nodemailer.getTestMessageUrl(result);
  return typeof previewUrl === "string" ? previewUrl : undefined;
}
