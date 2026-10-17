const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type EmailStatus = "scheduled" | "processing" | "sent" | "failed";

export interface EmailRecord {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  updatedAt: string;
  status: EmailStatus;
  attempts: number;
  error: string | null;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
  degraded?: boolean;
}

export interface SchedulePayload {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit?: number;
  sender?: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(payload?.error ?? `Request failed (${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  devLogin: () => request<{ user: User }>("/auth/dev", { method: "POST" }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  senders: () => request<{ data: string[] }>("/api/emails/senders"),
  listEmails: (kind: "scheduled" | "sent", page = 1) =>
    request<PageResult<EmailRecord>>(`/api/emails/${kind}?page=${page}&pageSize=25`),
  searchEmails: (params: { q: string; status: EmailStatus; page?: number }) => {
    const query = new URLSearchParams({
      q: params.q,
      status: params.status,
      page: String(params.page ?? 1),
      pageSize: "25",
    });
    return request<PageResult<EmailRecord>>(`/api/emails/search?${query.toString()}`);
  },
  schedule: (payload: SchedulePayload) =>
    request<{ count: number; data: Array<{ id: string }> }>("/api/emails/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  slackStatus: () => request<{ connected: boolean; connections: Array<{ id: string; teamName: string | null }> }>("/api/slack/status"),
  disconnectSlack: () => request<void>("/api/slack/disconnect", { method: "DELETE" }),
  slackConnectUrl: `${API_URL}/api/slack/connect`,
  googleLoginUrl: `${API_URL}/auth/google`,
};
