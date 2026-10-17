import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import dotenv from "dotenv";
import { Redis } from "ioredis";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(root, "backend");
dotenv.config({ path: path.join(backendDir, ".env") });

const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
let apiProcess;
let workerProcess;
let cookie;

function startProcess(file) {
  const child = spawn(process.execPath, [file], {
    cwd: backendDir,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => console.error(`Could not start ${file}.`, error));
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function waitForHealth(child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("API did not become healthy within 45 seconds.");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname}: ${body?.error ?? response.status}`);
  return body;
}

async function startStack() {
  apiProcess = startProcess(path.join("dist", "server.js"));
  await waitForHealth(apiProcess);
  workerProcess = startProcess(path.join("dist", "worker.js"));
}

async function restartStack() {
  console.info("\nRestart demonstration: stopping API and worker with delayed jobs still pending...");
  await Promise.all([stopProcess(apiProcess), stopProcess(workerProcess)]);
  await sleep(1000);
  await startStack();
  console.info("API and worker restarted; persistent queue recovery is active.\n");
}

function utcHourKey(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}`;
}

async function getSentAndScheduled() {
  const [sent, scheduled] = await Promise.all([
    request("/api/emails/sent?page=1&pageSize=100"),
    request("/api/emails/scheduled?page=1&pageSize=100"),
  ]);
  return { sent: sent.data, scheduled };
}

async function main() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The demo script only runs when backend/.env sets NODE_ENV=development.");
  }
  if (!process.env.DATABASE_URL) throw new Error("Copy backend/.env.example to backend/.env and configure it first.");

  await startStack();
  const login = await fetch(`${apiUrl}/auth/dev`, { method: "POST" });
  const cookies = login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""];
  cookie = cookies[0]?.split(";")[0];
  if (!login.ok || !cookie) throw new Error("Local demo login failed. Run the database migration and seed first.");
  const { user } = await login.json();

  const slack = await request("/api/slack/status");
  if (!slack.connected) {
    throw new Error("Connect Slack to the local demo user in the dashboard before running this demo.");
  }
  const { data: senders } = await request("/api/emails/senders");
  const sender = senders[0];
  if (!sender) throw new Error("No Ethereal sender accounts are available.");

  const now = new Date();
  const currentHour = utcHourKey(now);
  const rateKey = `rate:${sender}:${currentHour}`;
  if (await redis.exists(rateKey)) {
    throw new Error(`Demo sender already has a rate counter this UTC hour (${rateKey}); retry next hour to keep the demo honest.`);
  }

  const recipients = Array.from({ length: 50 }, (_, index) => `mailflow-demo-${Date.now()}-${index}@example.com`);
  const batch = await request("/api/emails/schedule", {
    method: "POST",
    body: JSON.stringify({
      subject: "Mailflow scheduler restart demo",
      body: "This is a local Ethereal SMTP test message. No external recipient mailbox receives it.",
      recipients,
      sender,
      startTime: new Date(Date.now() + 30_000).toISOString(),
      delayBetweenEmails: 0,
      hourlyLimit: 1,
    }),
  });
  const restartProbe = await request("/api/emails/schedule", {
    method: "POST",
    body: JSON.stringify({
      subject: "Mailflow restart recovery probe",
      body: "This local Ethereal message is expected to send after the API and worker restart.",
      recipients: [`mailflow-restart-probe-${Date.now()}@example.com`],
      sender,
      startTime: new Date(Date.now() + 45_000).toISOString(),
      delayBetweenEmails: 0,
      hourlyLimit: 100,
    }),
  });
  const probeId = restartProbe.data[0].id;
  console.info(`Scheduled ${batch.count} recipients with a per-sender hourly limit of 1.`);
  console.info("Scheduled a separate recovery probe that can send in the current hour.");
  await restartStack();

  const deadline = Date.now() + 180_000;
  let alertSent = false;
  let probeSent = false;
  while (Date.now() < deadline && (!alertSent || !probeSent)) {
    const windowKeys = new Set([utcHourKey(new Date()), utcHourKey(new Date(Date.now() + 60_000))]);
    for (const windowKey of windowKeys) {
      const alertKey = `slack-alert:${sender}:${windowKey}`;
      if ((await redis.get(alertKey)) === "sent") alertSent = true;
    }
    const { sent } = await getSentAndScheduled();
    probeSent = sent.some((email) => email.id === probeId);
    await sleep(1500);
  }
  if (!alertSent) throw new Error("No successful Slack rate-limit alert was observed within 3 minutes.");
  if (!probeSent) throw new Error("The recovery probe was not sent after the process restart.");

  const beforeRestart = await getSentAndScheduled();
  console.info(`Slack alert observed. ${beforeRestart.scheduled.total} batch messages remain scheduled for the next UTC window.`);
  console.info(`Restart probe sent once. Current sent count: ${beforeRestart.sent.length}.`);

  await restartStack();
  await sleep(3000);
  const afterRestart = await getSentAndScheduled();
  const sentIds = afterRestart.sent.map((email) => email.id);
  if (new Set(sentIds).size !== sentIds.length) throw new Error("Duplicate sent rows were found.");
  if (!sentIds.includes(probeId)) throw new Error("The restart probe disappeared after the second restart.");
  if (afterRestart.sent.length !== beforeRestart.sent.length) {
    console.info(`Additional queued work completed after restart (${beforeRestart.sent.length} -> ${afterRestart.sent.length} sent).`);
  }
  console.info(`Verified no duplicate database sends; ${afterRestart.scheduled.total} messages remain durably delayed until the next UTC hour.`);
  console.info("Demo complete. Remaining rate-limited recipients are intentionally delayed, not dropped.");
}

main().catch((error) => {
  console.error("\nDemo failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all([stopProcess(apiProcess), stopProcess(workerProcess)]);
  await redis.quit();
});
