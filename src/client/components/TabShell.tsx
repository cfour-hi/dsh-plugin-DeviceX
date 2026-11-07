/** Shared tab shell: loading skeleton, section error, non-fatal errors, then the body. */
import type { ReactNode } from "react";
import { Fragment, h } from "../jsx.js";
import { asObject, isObj, numOr, safeErrorText, strOr } from "../helpers.js";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { SectionErrors } from "./SectionErrors";
import { Skeleton } from "./Skeleton";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface TabState {
  status?: string;
  data?: any;
  error?: any;
  fetchedAt?: number;
}

export interface TabShellProps {
  t: Translator;
  state?: TabState;
  skeletonCards?: number;
  errorTitle?: string;
  errorText?: string;
  onRetry?: () => void;
  errorsKey?: string;
  children: (data: any) => ReactNode;
}

export function TabShell(props: TabShellProps) {
  const t = props.t;
  const state = asObject(props.state) as TabState;
  const status = strOr(state.status, "idle");
  if (status === "idle" || (status === "loading" && !state.data)) {
    return (
      <>
        <Skeleton cards={numOr(props.skeletonCards, 3)} />
        <p className="dx-loadingHint" role="status">
          {t("loading.sectionHint")}
        </p>
      </>
    );
  }
  if (status === "error" && !state.data) {
    const detail = safeErrorText(state.error);
    return (
      <ErrorState
        t={t}
        title={props.errorTitle || t("error.section")}
        text={(props.errorText ? props.errorText + " " : "") + t("error.sectionHint") + (detail ? " (" + detail + ")" : "")}
        onRetry={props.onRetry}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (!isObj(state.data)) {
    return (
      <EmptyState
        title={t("common.empty")}
        text={t("error.sectionHint")}
        action={
          props.onRetry ? (
            <button type="button" className="dx-btn" onClick={props.onRetry}>
              {t("common.retry")}
            </button>
          ) : null
        }
      />
    );
  }
  return (
    <>
      <SectionErrors t={t} section={state.data} labelKey={props.errorsKey} />
      {props.children(state.data)}
    </>
  );
}

// Re-export the Fragment marker so downstream tabs can use `<>...</>` with the
// same classic transform without importing jsx.js directly.
export { Fragment };
