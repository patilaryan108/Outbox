import type { EmailStatus } from "../api/client";

export function Badge({ status }: { status: EmailStatus }) {
  const label = status === "processing" ? "Processing" : status[0]!.toUpperCase() + status.slice(1);
  return <span className={`badge badge-${status}`}><span className="badge-dot" />{label}</span>;
}
