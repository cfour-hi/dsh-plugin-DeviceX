/** Cleanup tab: allowlisted scan, selection and confirmed deletion. */
import { Fragment, h } from "../jsx.js";
import { api } from "../api.js";
import { asArray, asObject, asObject as asObj, fmtBytes, fmtTime, safeErrorText } from "../helpers.js";
import { normalizeCleanup } from "../normalizers.js";
import { useCallback, useEffect, useRef, useState } from "../hooks.js";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { Skeleton } from "./Skeleton";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const CLEANUP_CATEGORY_KEYS: Record<string, string> = {
  cache: "cleanup.item.cache",
  logs: "cleanup.item.logs",
  trash: "cleanup.item.trash",
  temp: "cleanup.item.temp",
  developer: "cleanup.item.developer",
  updates: "cleanup.item.updates",
};

export interface CleanupTabProps {
  t: Translator;
  onAction: (id: string, params?: Record<string, unknown>) => Promise<any>;
}

export function CleanupTab(props: CleanupTabProps) {
  const t = props.t;
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [selected, setSelected] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(null);
  const load = useCallback((fresh: boolean) => {
    if (inFlight.current) return inFlight.current;
    setState((previous: any) => ({ status: previous.data ? "ready" : "loading", data: previous.data, error: null }));
    const promise = api
      .cleanup(fresh === true)
      .then((raw: any) => setState({ status: "ready", data: normalizeCleanup(raw), error: null }))
      .catch((error: any) =>
        setState((previous: any) => ({ status: previous.data ? "ready" : "error", data: previous.data, error })),
      )
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = promise;
    return promise;
  }, []);
  useEffect(() => {
    load(false);
  }, [load]);
  const data = state.data;
  if (state.status === "loading" && !data) {
    return (
      <Fragment>
        <Skeleton cards={3} />
        <p className="dx-loadingHint" role="status">
          {t("cleanup.scanning")}
        </p>
      </Fragment>
    );
  }
  if (state.status === "error" && !data) {
    return (
      <ErrorState t={t} title={t("cleanup.error")} text={safeErrorText(state.error)} onRetry={() => load(true)} retryLabel={t("common.retry")} />
    );
  }
  const items = data ? data.items : [];
  const selectable = items.filter((item: any) => item.exists !== false && item.bytes > 0);
  const selectedItems = selectable.filter((item: any) => selected[item.id] === true);
  const selectedBytes = selectedItems.reduce((total: number, item: any) => total + item.bytes, 0);
  const selectedFiles = selectedItems.reduce((total: number, item: any) => total + item.files, 0);
  const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
  const toggleItem = (id: string) => {
    setNotice("");
    setConfirming(false);
    setSelected((previous) => Object.assign({}, previous, { [id]: previous[id] !== true }));
  };
  const selectAll = () => {
    setNotice("");
    setConfirming(false);
    if (allSelected) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of selectable) next[item.id] = true;
    setSelected(next);
  };
  const runDelete = async () => {
    if (selectedItems.length === 0) {
      setNotice(t("cleanup.noneSelected"));
      return;
    }
    setBusy(true);
    setNotice("");
    const ids = selectedItems.map((item: any) => item.id);
    const result = await props.onAction("cleanup.delete", { ids });
    setBusy(false);
    setConfirming(false);
    if (result && result.ok) {
      setSelected({});
      await load(true);
    }
  };
  return (
    <div className="dx-section">
      <Card
        title={t("tab.cleanup")}
        icon="trash"
        subtitle={t("cleanup.intro")}
        actions={
          <button
            type="button"
            className="dx-btn"
            data-size="sm"
            onClick={() => load(true)}
            disabled={state.status === "loading"}
          >
            <Icon name="refresh" size={13} />
            {t("cleanup.scan")}
          </button>
        }
      >
        <div className="dx-cleanupTop">
          <div>
            <div className="dx-cleanupTotal">{fmtBytes(data ? data.totalBytes : 0)}</div>
            <div className="dx-cleanupMeta">
              {t("cleanup.reclaimable") +
                " · " +
                t("cleanup.files", { n: data ? data.totalFiles : 0 }) +
                (data && data.generatedAt ? " · " + t("cleanup.updated", { time: fmtTime(data.generatedAt) }) : "")}
            </div>
          </div>
          <span className="dx-grow" />
          <div className="dx-cleanActions">
            <button
              type="button"
              className="dx-linkBtn"
              onClick={selectAll}
              disabled={selectable.length === 0}
            >
              {allSelected ? t("cleanup.selectNone") : t("cleanup.selectAll")}
            </button>
            <button
              type="button"
              className="dx-btn"
              data-variant="primary"
              onClick={() => {
                if (selectedItems.length === 0) {
                  setNotice(t("cleanup.noneSelected"));
                  return;
                }
                setConfirming(true);
              }}
              disabled={busy || selectedItems.length === 0}
            >
              <Icon name="trash" size={13} />
              {busy ? t("cleanup.deleting") : t("cleanup.delete")}
            </button>
          </div>
        </div>
        <p className="dx-small dx-muted" style={{ marginTop: "8px" }}>
          {t("cleanup.selected", { value: fmtBytes(selectedBytes) }) +
            (selectedItems.length > 0 ? " · " + t("cleanup.files", { n: selectedFiles }) : "")}
        </p>
        {notice ? (
          <div className="dx-banner" data-tone="warn" role="status">
            <span className="dx-bannerText">{notice}</span>
          </div>
        ) : null}
        {confirming ? (
          <div className="dx-banner" data-tone="danger" role="alert">
            <span className="dx-bannerText">
              {t("cleanup.confirmTitle") + " " + t("cleanup.confirmBody", { value: fmtBytes(selectedBytes), n: selectedFiles })}
            </span>
            <div className="dx-cleanActions">
              <button type="button" className="dx-btn" data-size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                {t("cleanup.cancel")}
              </button>
              <button type="button" className="dx-btn" data-variant="danger" data-size="sm" onClick={runDelete} disabled={busy}>
                {t("cleanup.confirmLabel")}
              </button>
            </div>
          </div>
        ) : null}
        <div className="dx-cleanupRows">
          {items.length === 0 ? (
            <EmptyState icon="trash" title={t("cleanup.scanEmpty")} />
          ) : (
            items.map((item: any) => (
              <div className="dx-cleanRow" key={item.id}>
                <input
                  type="checkbox"
                  className="dx-cleanCheck"
                  checked={selected[item.id] === true}
                  disabled={item.exists === false || item.bytes === 0}
                  aria-label={item.label}
                  onChange={() => toggleItem(item.id)}
                />
                <div className="dx-cleanMain">
                  <div className="dx-cleanTitle">
                    {item.label}
                    <Pill tone="idle">{t(CLEANUP_CATEGORY_KEYS[item.category] || "cleanup.item.cache")}</Pill>
                    {item.requiresAdmin ? (
                      <Pill tone="warn" title={t("cleanup.adminHint")}>
                        {t("cleanup.admin")}
                      </Pill>
                    ) : null}
                    {item.exists === false ? <Pill tone="idle">{t("common.na")}</Pill> : null}
                  </div>
                  {item.detail ? <div className="dx-cleanPath">{item.detail}</div> : null}
                  {item.path ? (
                    <div className="dx-cleanPath" title={item.path}>
                      {item.path}
                    </div>
                  ) : null}
                  {item.error ? <div className="dx-cleanPath">{item.error}</div> : null}
                </div>
                <div className="dx-cleanSize">
                  <div>{fmtBytes(item.bytes)}</div>
                  <div className="dx-cleanSizeSub">{t("cleanup.files", { n: item.files })}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
