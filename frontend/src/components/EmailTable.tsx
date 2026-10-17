import { ArrowUp, ArrowUpDown, Inbox, RotateCw } from "lucide-react";
import type { EmailRecord } from "../api/client";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export function EmailTable({ emails, kind, loading, error, onRetry }: {
  emails: EmailRecord[];
  kind: "scheduled" | "sent";
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && emails.length === 0) {
    return <div className="skeleton-list" aria-label="Loading emails">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index} />)}</div>;
  }
  if (!loading && error) {
    return <EmptyState icon={<Inbox size={25} />} title="Couldn't load emails" description={error} action={<Button variant="secondary" icon={<RotateCw size={14} />} onClick={onRetry}>Try again</Button>} />;
  }
  if (!loading && emails.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={25} />}
        title="Nothing here yet"
        description={kind === "scheduled" ? "Your scheduled emails will appear here." : "Emails will show here after they are sent."}
      />
    );
  }
  return (
    <div className="table-scroll">
      <table className="email-table">
        <thead>
          <tr>
            <th>Recipient <ArrowUpDown size={13} /></th>
            <th>Subject <ArrowUpDown size={13} /></th>
            <th>{kind === "scheduled" ? "Scheduled for" : "Sent at"} <ArrowUpDown size={13} /></th>
            <th>Status <ArrowUpDown size={13} /></th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => {
            const timestamp = kind === "scheduled" ? email.scheduledAt : email.sentAt ?? (email.status === "failed" ? email.updatedAt : null);
            return (
              <tr key={email.id}>
                <td><span className="recipient">{email.recipient}</span></td>
                <td><span className="subject">{email.subject}</span></td>
                <td className="time-cell">{timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)) : "—"}</td>
                <td><Badge status={email.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && <div className="refresh-indicator"><ArrowUp size={13} /> Refreshing</div>}
    </div>
  );
}
