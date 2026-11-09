/**
 * Uninstall-footprint dialog body.
 *
 * Lists where an application keeps data outside its bundle and lets the user
 * choose what to remove along with it. Four confidence tiers drive both the
 * default selection and what the UI is allowed to offer:
 *
 *   high      confirmed (bundle id / MSIX / brew zap)   -> preselected
 *   medium    name similarity only                      -> opt-in
 *   conflict  name similarity, two or more possible owners -> opt-in, names shown
 *   shared    vendor-level directory                    -> no checkbox at all
 *
 * The component never holds a path for deletion: it sends `scanId` + item ids,
 * and the host resolves those through its scan token.
 */
import { h } from "../jsx.js";
import { asArray, asObject, fmtBytes, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Pill } from "./Pill";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const TIER_KEYS: Record<string, string> = {
  high: "fp.tier.high",
  medium: "fp.tier.medium",
  conflict: "fp.tier.conflict",
  shared: "fp.tier.shared",
};

const TIER_TONES: Record<string, string> = {
  high: "ok",
  medium: "warn",
  conflict: "warn",
  shared: "idle",
};

export interface FootprintItem {
  id: string;
  kind: string;
  path: string;
  displayPath: string;
  bytes: number;
  files: number;
  confidence: string;
  source: string;
  reason: string;
  alsoMatchedBy: string[];
  requiresAdmin: boolean;
  exists: boolean;
  warning: string;
  selectable: boolean;
  defaultSelected: boolean;
}

export interface NormalizedFootprint {
  scanId: string;
  appPath: string;
  bundleId: string;
  sandboxed: boolean;
  generatedAt: number;
  durationMs: number;
  items: FootprintItem[];
  totalBytes: number;
  selectedBytes: number;
  errors: string[];
}

export interface UninstallFootprintModalProps {
  t: Translator;
  appName: string;
  footprint: NormalizedFootprint;
  busy?: boolean;
  notice?: string;
  onSelectionChange?: (ids: string[], bytes: number) => void;
  onOpenCleanup?: () => void;
}

/**
 * Default selection = every item the host marked `defaultSelected` (tier A).
 * Exported so `page.tsx` and the render tests agree with the component.
 * @param {FootprintItem[]} items
 * @returns {Record<string, boolean>}
 */
export function defaultSelection(items: FootprintItem[]): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (item.selectable && item.defaultSelected) selected[item.id] = true;
  }
  return selected;
}

/**
 * Bytes and count for a selection; shared/admin-only rows never count.
 * @param {FootprintItem[]} items
 * @param {Record<string, boolean>} selected
 * @returns {{bytes: number, files: number, ids: string[]}}
 */
export function summarizeSelection(items: FootprintItem[], selected: Record<string, boolean>) {
  let bytes = 0;
  let files = 0;
  const ids: string[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (selected[item.id] !== true) continue;
    ids.push(item.id);
    bytes += Number(item.bytes) || 0;
    files += Number(item.files) || 0;
  }
  return { bytes, files, ids };
}

export function UninstallFootprintModal(props: UninstallFootprintModalProps) {
  const t = props.t;
  const footprint = asObject(props.footprint) as NormalizedFootprint;
  const items = asArray(footprint.items) as FootprintItem[];
  const [selected, setSelected] = useState(() => defaultSelection(items));

  const toggle = (id: string) => {
    setSelected((previous: Record<string, boolean>) => {
      const next = Object.assign({}, previous);
      if (next[id] === true) delete next[id];
      else next[id] = true;
      const summary = summarizeSelection(items, next);
      if (props.onSelectionChange) props.onSelectionChange(summary.ids, summary.bytes);
      return next;
    });
  };

  const summary = summarizeSelection(items, selected);
  const unselected = items.filter((item) => item.selectable && selected[item.id] !== true);
  const unselectedBytes = unselected.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const selectableItems = items.filter((item) => item.selectable);
  const allSelected = selectableItems.length > 0 && summary.ids.length === selectableItems.length;

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allSelected) for (const item of selectableItems) next[item.id] = true;
    setSelected(next);
    const nextSummary = summarizeSelection(items, next);
    if (props.onSelectionChange) props.onSelectionChange(nextSummary.ids, nextSummary.bytes);
  };

  return (
    <div className="dx-fp" data-busy={props.busy === true ? "true" : undefined}>
      <div className="dx-fpHead">
        <div className="dx-fpFacts">
          {footprint.bundleId ? (
            <span className="dx-small dx-muted">
              {t("fp.bundleIdLabel")}: <span className="dx-mono">{footprint.bundleId}</span>
            </span>
          ) : null}
          <Pill tone="idle">{footprint.sandboxed ? t("fp.sandboxed") : t("fp.notSandboxed")}</Pill>
          <span className="dx-small dx-muted">{t("fp.total", { n: items.length, value: fmtBytes(footprint.totalBytes) })}</span>
        </div>
        <div className="dx-cleanActions">
          {selectableItems.length > 0 ? (
            <button type="button" className="dx-linkBtn" onClick={toggleAll} disabled={props.busy === true}>
              {allSelected ? t("cleanup.selectNone") : t("cleanup.selectAll")}
            </button>
          ) : null}
        </div>
      </div>

      <p className="dx-small dx-muted">{t("fp.intro")}</p>

      {items.length === 0 ? (
        <EmptyState icon="search" title={t("fp.noItems")} />
      ) : (
        <div className="dx-cleanupRows">
          {items.map((item) => {
            const tierKey = TIER_KEYS[item.confidence];
            const tierTone = TIER_TONES[item.confidence] || "idle";
            const checked = selected[item.id] === true;
            const isShared = item.confidence === "shared" || item.requiresAdmin;
            return (
              <div className="dx-cleanRow dx-fpRow" key={item.id} data-tier={item.confidence}>
                {item.selectable && !isShared ? (
                  <input
                    type="checkbox"
                    className="dx-cleanCheck"
                    checked={checked}
                    disabled={props.busy === true || item.exists === false}
                    aria-label={item.displayPath}
                    onChange={() => toggle(item.id)}
                  />
                ) : (
                  <span className="dx-cleanCheck" aria-hidden="true" />
                )}
                <div className="dx-cleanMain">
                  <div className="dx-cleanTitle">
                    <span className="dx-truncate" title={item.displayPath}>
                      {item.displayPath}
                    </span>
                    {tierKey ? <Pill tone={tierTone}>{t(tierKey)}</Pill> : null}
                    {item.requiresAdmin ? (
                      <Pill tone="warn" title={t("fp.adminHint")}>
                        {t("cleanup.admin")}
                      </Pill>
                    ) : null}
                    {item.warning ? (
                      <Pill tone="idle" title={item.warning}>
                        {t("fp.warning")}
                      </Pill>
                    ) : null}
                  </div>
                  {item.reason ? <div className="dx-cleanPath">{item.reason}</div> : null}
                  {item.confidence === "shared" ? <div className="dx-cleanPath">{t("fp.tier.sharedHint")}</div> : null}
                  {item.alsoMatchedBy.length > 0 ? (
                    <div className="dx-cleanPath">{t("fp.alsoMatched", { names: item.alsoMatchedBy.join(", ") })}</div>
                  ) : null}
                </div>
                <div className="dx-cleanSize">
                  <div>{fmtBytes(item.bytes)}</div>
                  <div className="dx-cleanSizeSub">{t("cleanup.files", { n: item.files })}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="dx-fpSummary">
        <span className="dx-small">
          <Icon name="trash" size={12} /> {t("fp.selected", { value: fmtBytes(summary.bytes), n: summary.files })}
        </span>
        {/* The hint is not decoration: without it a user confirms and the large
            unselected directory silently survives. */}
        {unselected.length > 0 ? (
          <span className="dx-small dx-muted">{t("fp.unselectedHint", { n: unselected.length, value: fmtBytes(unselectedBytes) })}</span>
        ) : null}
      </div>

      {summary.bytes > 0 ? (
        <div className="dx-banner" data-tone="warn" role="note">
          <span className="dx-bannerText">{t("fp.spaceHint", { value: fmtBytes(summary.bytes) })}</span>
          {props.onOpenCleanup ? (
            <button type="button" className="dx-linkBtn" onClick={props.onOpenCleanup}>
              {t("fp.emptyTrash")}
            </button>
          ) : null}
        </div>
      ) : null}

      {props.notice ? (
        <div className="dx-banner" data-tone="warn" role="status">
          <span className="dx-bannerText">{strOr(props.notice, "")}</span>
        </div>
      ) : null}

      {asArray(footprint.errors).length > 0 ? (
        <div className="dx-banner" data-tone="warn" role="status">
          <span className="dx-bannerText">{asArray(footprint.errors).slice(0, 3).join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
}
