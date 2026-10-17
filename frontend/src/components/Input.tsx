import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Input({ label, hint, id, ...props }: InputProps) {
  const inputId = id ?? props.name;
  return (
    <label className="field" htmlFor={inputId}>
      {label && <span className="field-label">{label}</span>}
      <input id={inputId} className="input" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export function Textarea({ label, hint, id, ...props }: TextareaProps) {
  const inputId = id ?? props.name;
  return (
    <label className="field" htmlFor={inputId}>
      {label && <span className="field-label">{label}</span>}
      <textarea id={inputId} className="input textarea" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
