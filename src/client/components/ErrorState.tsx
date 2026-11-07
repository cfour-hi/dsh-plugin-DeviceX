/** Section-level error panel with an optional retry button. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { Icon } from "./Icon";

export type Translator = (key: string) => string;

export interface ErrorStateProps {
  t?: Translator;
  title?: ReactNode;
  text?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState(props: ErrorStateProps) {
  const t = props.t || ((key: string) => key);
  return (
    <div className="dx-error" role="alert">
      <span className="dx-errorIcon">
        <Icon name="warning" size={24} />
      </span>
      {props.title ? <p className="dx-errorTitle">{props.title}</p> : null}
      {props.text ? <p className="dx-errorText">{props.text}</p> : null}
      {props.onRetry ? (
        <button type="button" className="dx-btn" data-variant="primary" onClick={props.onRetry}>
          <Icon name="refresh" size={14} />
          {props.retryLabel || t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
