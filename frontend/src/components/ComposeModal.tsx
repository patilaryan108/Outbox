import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp, Send } from "lucide-react";
import { api } from "../api/client";
import { Button } from "./Button";
import { Input, Textarea } from "./Input";
import { Modal } from "./Modal";

function extractEmails(value: string): string[] {
  const matches = value.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ComposeModal({ onClose, onScheduled }: { onClose: () => void; onScheduled: (count: number) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [leads, setLeads] = useState("");
  const [startTime, setStartTime] = useState(localDateTimeValue(new Date(Date.now() + 60_000)));
  const [delay, setDelay] = useState("2");
  const [limit, setLimit] = useState("100");
  const [senders, setSenders] = useState<string[]>([]);
  const [sender, setSender] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipients = useMemo(() => extractEmails(leads), [leads]);

  useEffect(() => {
    void api.senders().then((result) => setSenders(result.data)).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load configured senders.");
    });
  }, []);

  const uploadLeads = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setLeads(await file.text());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!recipients.length) {
      setError("Add at least one valid recipient email.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.schedule({
        subject,
        body,
        recipients,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmails: Number(delay),
        hourlyLimit: limit ? Number(limit) : undefined,
        sender: sender || undefined,
      });
      onScheduled(result.count);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule these emails.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Compose new email" onClose={onClose}>
      <form className="compose-form" onSubmit={(event) => void submit(event)}>
        <Input label="Subject" name="subject" placeholder="A thoughtful subject line" required maxLength={500} value={subject} onChange={(event) => setSubject(event.target.value)} />
        <Textarea label="Email body" name="body" placeholder="Write your email..." required rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
        <div className="field">
          <div className="field-topline">
            <span className="field-label">Recipients</span>
            <label className="upload-button">
              <FileUp size={15} /> Upload CSV or text
              <input type="file" accept=".csv,.txt,text/plain,text/csv" onChange={(event) => void uploadLeads(event)} />
            </label>
          </div>
          <textarea className="input textarea recipient-input" name="recipients" rows={4} placeholder="Paste a CSV or list of email addresses..." value={leads} onChange={(event) => setLeads(event.target.value)} />
          <div className="recipient-count"><span className={recipients.length ? "count-good" : ""}>{recipients.length} valid unique email{recipients.length === 1 ? "" : "s"} detected</span><span>Duplicates are removed</span></div>
        </div>
        <div className="schedule-options">
          <label className="field">
            <span className="field-label">Sender</span>
            <select className="input" value={sender} onChange={(event) => setSender(event.target.value)}>
              <option value="">Rotate senders automatically</option>
              {senders.map((address) => <option key={address} value={address}>{address}</option>)}
            </select>
          </label>
          <Input label="Start time" name="startTime" type="datetime-local" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          <Input label="Delay between emails (sec)" name="delay" type="number" min="0" max="86400" step="1" required value={delay} onChange={(event) => setDelay(event.target.value)} />
          <Input label="Hourly limit per sender" name="hourlyLimit" type="number" min="1" step="1" value={limit} onChange={(event) => setLimit(event.target.value)} hint="Per-schedule override" />
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-footer">
          <span className="form-note">Emails are distributed across your configured senders.</span>
          <div className="form-actions">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || recipients.length === 0} icon={<Send size={16} />}>
              {submitting ? "Scheduling..." : `Schedule ${recipients.length || ""} email${recipients.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
