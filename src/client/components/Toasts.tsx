/** Toast stack with auto-dismiss timers. */
import { h } from "../jsx.js";
import { asArray } from "../helpers.js";
import { useEffect } from "../hooks.js";
import { Icon } from "./Icon";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ToastEntry {
  id: number | string;
  tone: string;
  title: string;
  message?: string;
}

export interface ToastItemProps {
  t: Translator;
  toast: ToastEntry;
  onDismiss: (id: number | string) => void;
}

export function ToastItem(props: ToastItemProps) {
  const t = props.t;
  const toast = props.toast;
  useEffect(() => {
    const timer = setTimeout(() => props.onDismiss(toast.id), toast.tone === "fail" ? 6500 : 4200);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, props.onDismiss]);
  return (
    <div className="dx-toast" data-tone={toast.tone}>
      <span className="dx-toastIcon">
        <Icon name={toast.tone === "ok" ? "check" : "warning"} size={16} />
      </span>
      <div className="dx-toastBody">
        <div className="dx-toastTitle">{toast.title}</div>
        {toast.message ? <div className="dx-toastMsg">{toast.message}</div> : null}
      </div>
      <button
        type="button"
        className="dx-btn"
        data-size="icon"
        aria-label={t("toast.dismiss")}
        onClick={() => props.onDismiss(toast.id)}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

export interface ToastsProps {
  t: Translator;
  toasts?: ToastEntry[];
  onDismiss: (id: number | string) => void;
}

export function Toasts(props: ToastsProps) {
  const toasts = asArray(props.toasts) as ToastEntry[];
  if (toasts.length === 0) return null;
  return (
    <div className="dx-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} t={props.t} toast={toast} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}
