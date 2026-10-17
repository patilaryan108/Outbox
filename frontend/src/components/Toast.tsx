import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface ToastMessage {
  type: "success" | "error";
  text: string;
}

export function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type}`} role="status">
      {toast.type === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
      <span>{toast.text}</span>
      <button className="icon-button" aria-label="Dismiss" onClick={onClose}><X size={16} /></button>
    </div>
  );
}
