/** Modal dialog with focus trapping, Escape handling and confirm/cancel footer. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { FALLBACK_T } from "../helpers.js";
import { asArray, isObj } from "../helpers.js";
import { useEffect, useId, useRef } from "../hooks.js";
import { Icon } from "./Icon";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ModalDetail {
  label: ReactNode;
  value: ReactNode;
}

export interface ModalProps {
  t?: Translator;
  title?: ReactNode;
  description?: ReactNode;
  details?: ModalDetail[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  errorText?: string;
  onClose?: () => void;
  onConfirm?: () => void;
  children?: ReactNode;
}

export function Modal(props: ModalProps) {
  const t = typeof props.t === "function" ? props.t : FALLBACK_T;
  const rootRef = useRef(null);
  const closeRef = useRef(props.onClose);
  const confirmRef = useRef(props.onConfirm);
  closeRef.current = props.onClose;
  confirmRef.current = props.onConfirm;
  const seed = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = "dx-modal-title-" + seed;
  useEffect(() => {
    const root = rootRef.current;
    const previous = typeof document !== "undefined" ? document.activeElement : null;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback: any) => setTimeout(callback, 0);
    const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    const focusFirst = () => {
      if (!root) return;
      const target = root.querySelector(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href]",
      );
      try {
        if (target && typeof target.focus === "function") target.focus();
        else if (typeof root.focus === "function") root.focus();
      } catch (_error) {
        /* focus is best-effort */
      }
    };
    const frame = raf(focusFirst);
    const onKeyDown = (event: any) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closeRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = Array.prototype.slice.call(
        root.querySelectorAll("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href]"),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancel(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      try {
        if (previous && typeof (previous as any).focus === "function") (previous as any).focus();
      } catch (_error) {
        /* focus is best-effort */
      }
    };
  }, []);
  const details = asArray(props.details).filter((entry) => isObj(entry)) as ModalDetail[];
  return (
    <div className="dx-modalRoot">
      <div
        className="dx-modalMask"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && closeRef.current) closeRef.current();
        }}
      />
      <div className="dx-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={rootRef}>
        <div className="dx-modalHead">
          <h2 className="dx-modalTitle" id={titleId}>
            {props.title}
          </h2>
          <button
            type="button"
            className="dx-btn dx-modalClose"
            data-size="icon"
            aria-label={t("aria.close")}
            onClick={() => closeRef.current && closeRef.current()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dx-modalBody">
          {props.description ? <p>{props.description}</p> : null}
          {details.length > 0 ? (
            <div className="dx-modalDetails">
              {details.map((entry, index) => (
                <div className="dx-modalDetailRow" key={index}>
                  <span className="dx-modalDetailLabel">{entry.label}</span>
                  <span className="dx-modalDetailValue">{entry.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {props.children || null}
          {props.errorText ? (
            <p className="dx-inlineError" role="alert" style={{ marginTop: "10px" }}>
              {props.errorText}
            </p>
          ) : null}
        </div>
        <div className="dx-modalFooter">
          <button type="button" className="dx-btn" onClick={() => closeRef.current && closeRef.current()} disabled={props.busy === true}>
            {props.cancelLabel || t("common.cancel")}
          </button>
          <button
            type="button"
            className="dx-btn"
            data-variant={props.danger ? "danger" : "primary"}
            onClick={() => confirmRef.current && confirmRef.current()}
            disabled={props.busy === true}
          >
            {props.busy === true ? t("common.pending") : props.confirmLabel || t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
