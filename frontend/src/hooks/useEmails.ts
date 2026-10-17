import { useEffect, useState } from "react";
import { api, type EmailRecord, type PageResult } from "../api/client";

export function useEmails(kind: "scheduled" | "sent", query: string, page: number) {
  const [result, setResult] = useState<PageResult<EmailRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const status = kind === "sent" ? "sent" : "scheduled";
    const fetchEmails = async () => {
      try {
        const response = query.trim()
          ? await api.searchEmails({ q: query.trim(), status, page })
          : await api.listEmails(kind, page);
        if (active) {
          setResult(response);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load emails.");
      } finally {
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void fetchEmails();
    const interval = window.setInterval(() => void fetchEmails(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [kind, query, page, version]);

  return {
    emails: result?.data ?? [],
    total: result?.total ?? 0,
    totalPages: result?.totalPages ?? Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 25)),
    loading,
    error,
    refresh: () => setVersion((v) => v + 1),
  };
}
