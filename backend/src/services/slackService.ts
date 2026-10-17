import { prisma } from "../db/client.js";
import { env } from "../config/env.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";

interface SlackSecret {
  accessToken: string;
  webhookUrl?: string;
  channelId?: string;
}

function encrypt(value: SlackSecret): string {
  return encryptSecret(JSON.stringify(value));
}

function decrypt(value: string): SlackSecret {
  return JSON.parse(decryptSecret(value)) as SlackSecret;
}

export async function saveSlackConnection(userId: string, response: {
  access_token: string;
  scope?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { url?: string; channel_id?: string };
}): Promise<void> {
  if (!response.access_token || !response.team?.id) throw new Error("Slack OAuth response is missing token or team identity.");
  await prisma.slackConnection.upsert({
    where: { userId_teamId: { userId, teamId: response.team.id } },
    create: {
      userId,
      teamId: response.team.id,
      teamName: response.team.name,
      accessTokenCipher: encrypt({
        accessToken: response.access_token,
        webhookUrl: response.incoming_webhook?.url,
        channelId: response.incoming_webhook?.channel_id,
      }),
      scope: response.scope ?? "",
    },
    update: {
      teamName: response.team.name,
      accessTokenCipher: encrypt({
        accessToken: response.access_token,
        webhookUrl: response.incoming_webhook?.url,
        channelId: response.incoming_webhook?.channel_id,
      }),
      scope: response.scope ?? "",
    },
  });
}

export async function hasSlackConnection(userId: string): Promise<boolean> {
  return (await prisma.slackConnection.count({ where: { userId } })) > 0;
}

export async function disconnectSlack(userId: string): Promise<void> {
  await prisma.slackConnection.deleteMany({ where: { userId } });
}

export async function notifySlackLimit(userId: string, sender: string, window: string, limit: number): Promise<void> {
  const connection = await prisma.slackConnection.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!connection) return;
  const secret = decrypt(connection.accessTokenCipher);
  const text = `Hourly email limit (${limit}) reached for ${sender} during ${window} UTC. Remaining emails are queued for the next hour.`;
  let response: Response;
  if (secret.webhookUrl) {
    response = await fetch(secret.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Slack notification failed with HTTP ${response.status}.`);
    return;
  } else if (secret.channelId) {
    response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret.accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: secret.channelId, text }),
      signal: AbortSignal.timeout(5000),
    });
  } else {
    return;
  }
  if (!response.ok) throw new Error(`Slack notification failed with HTTP ${response.status}.`);
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!result.ok && !secret.webhookUrl) throw new Error(`Slack notification failed: ${result.error ?? "unknown error"}`);
}

export function getSlackOAuthConfig(): { clientId: string; clientSecret: string; callbackUrl: string } {
  return {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    callbackUrl: env.SLACK_CALLBACK_URL,
  };
}
