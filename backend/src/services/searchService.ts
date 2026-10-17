import { Client } from "@elastic/elasticsearch";
import type { Email } from "@prisma/client";
import { env } from "../config/env.js";

const client = new Client({ node: env.ELASTICSEARCH_URL, requestTimeout: 10_000, maxRetries: 0 });
let indexReady = false;

async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const exists = await client.indices.exists({ index: env.ELASTICSEARCH_INDEX });
  if (!exists) {
    await client.indices.create({
      index: env.ELASTICSEARCH_INDEX,
      mappings: {
        properties: {
          userId: { type: "keyword" },
          status: { type: "keyword" },
          sender: { type: "keyword" },
          recipient: { type: "text" },
          subject: { type: "text" },
          body: { type: "text" },
          scheduledAt: { type: "date" },
          sentAt: { type: "date" },
        },
      },
    });
  }
  indexReady = true;
}

export async function ensureSearchIndex(): Promise<void> {
  await ensureIndex();
}

export async function indexEmail(email: Email): Promise<void> {
  await indexEmails([email]);
}

export async function indexEmails(emails: Email[]): Promise<void> {
  if (!emails.length) return;
  await ensureIndex();
  for (let offset = 0; offset < emails.length; offset += 100) {
    const batch = emails.slice(offset, offset + 100);
    const response = await client.bulk({
      operations: batch.flatMap((email) => [
        { index: { _index: env.ELASTICSEARCH_INDEX, _id: email.id } },
        {
          userId: email.userId,
          status: email.status,
          sender: email.sender,
          recipient: email.recipient,
          subject: email.subject,
          body: email.body,
          scheduledAt: email.scheduledAt,
          sentAt: email.sentAt,
        },
      ]),
      refresh: "wait_for",
    });
    if (response.errors) {
      const failure = response.items.find((item) => item.index?.error)?.index?.error;
      throw new Error(`Elasticsearch bulk indexing failed: ${failure?.reason ?? "one or more documents failed"}`);
    }
  }
}

export async function searchEmails(
  userId: string,
  query: string,
  status?: string,
  sender?: string,
  page = 1,
  pageSize = 25,
): Promise<{ hits: Array<{ id: string }>; total: number }> {
  await ensureIndex();
  const response = await client.search({
    index: env.ELASTICSEARCH_INDEX,
    from: (page - 1) * pageSize,
    size: pageSize,
    query: {
      bool: {
        must: query ? [{ multi_match: { query, fields: ["subject^3", "body", "recipient"] } }] : [{ match_all: {} }],
        filter: [
          { term: { userId } },
          ...(status
            ? status === "scheduled"
              ? [{ terms: { status: ["scheduled", "processing"] } }]
              : status === "sent"
                ? [{ terms: { status: ["sent", "failed"] } }]
              : [{ term: { status } }]
            : []),
          ...(sender ? [{ term: { sender } }] : []),
        ],
      },
    },
    sort: [{ scheduledAt: "desc" }, { _score: { order: "desc" } }],
  });
  const total = typeof response.hits.total === "number" ? response.hits.total : response.hits.total?.value ?? 0;
  return { hits: response.hits.hits.map((hit) => ({ id: String(hit._id) })), total };
}
