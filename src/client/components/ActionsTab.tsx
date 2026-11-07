/** Actions tab: the whole whitelisted action catalogue, generated forms and history. */
import { h } from "../jsx.js";
import { asArray, asObject, fmtDateTime, fmtTime, isIpv4, parseServerList, safeErrorText } from "../helpers.js";
import { ACTION_GROUPS, GROUP_LABEL_KEYS } from "../constants.js";
import { useEffect, useState } from "../hooks.js";
import {
  ActionCard,
  actionLabel,
  actionMetaOf,
  defaultParamValues,
  paramDisplayValue,
  paramLabel,
  validateActionParams,
} from "../action-helpers.js";
import type { ActionSpec } from "../action-helpers.js";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Pill } from "./Pill";
import { SectionHead } from "./SectionHead";
import { Skeleton } from "./Skeleton";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ActionsTabProps {
  t: Translator;
  catalog: any;
  history: any[];
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  openConfirm: (config: Record<string, unknown>) => void;
}

export function ActionsTab(props: ActionsTabProps) {
  const t = props.t;
  const pending = asObject(props.pending);
  const catalog = asObject(props.catalog);
  const actions = asArray(catalog.actions) as ActionSpec[];
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  useEffect(() => {
    setValues((previous: any) => {
      const next = Object.assign({}, previous);
      let changed = false;
      for (const action of actions) {
        if (next[action.id] === undefined) {
          next[action.id] = defaultParamValues(action);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [actions]);
  if (catalog.status === "loading" || catalog.status === "idle") return <Skeleton cards={4} />;
  if (catalog.status === "error") {
    return (
      <ErrorState
        t={t}
        title={t("error.section")}
        text={t("error.sectionHint") + (catalog.error ? " (" + safeErrorText(catalog.error) + ")" : "")}
        onRetry={props.onRetry}
        retryLabel={t("common.retry")}
      />
    );
  }
  const extraGroups: string[] = [];
  for (const action of actions) {
    if (ACTION_GROUPS.indexOf(action.group) < 0 && extraGroups.indexOf(action.group) < 0) extraGroups.push(action.group);
  }
  const groups = ACTION_GROUPS.concat(extraGroups);
  const history = asArray(props.history);
  const setActionValue = (actionId: string, name: string, next: unknown) => {
    setValues((previous: any) =>
      Object.assign({}, previous, { [actionId]: Object.assign({}, asObject(previous[actionId]), { [name]: next }) }),
    );
    setErrors((previous: any) => {
      const forAction = Object.assign({}, asObject(previous[actionId]));
      if (!forAction[name]) return previous;
      delete forAction[name];
      return Object.assign({}, previous, { [actionId]: forAction });
    });
  };
  const runAction = (action: ActionSpec, currentValues: Record<string, unknown>) => {
    const meta = actionMetaOf(action);
    const actionErrors = validateActionParams(t, action, currentValues);
    if (Object.keys(actionErrors).length > 0) {
      setErrors((previous: any) => Object.assign({}, previous, { [action.id]: actionErrors }));
      return;
    }
    // The DNS action's `servers` parameter is an array on the wire while the
    // generic form edits it as text; parse and validate it here.
    let params = currentValues;
    if (action.id === "network.setDns") {
      const servers = parseServerList(asObject(currentValues).servers);
      if (servers.length > 4 || servers.some((server: string) => !isIpv4(server))) {
        setErrors((previous: any) => Object.assign({}, previous, { [action.id]: { servers: t("net.dnsInvalid") } }));
        return;
      }
      params = Object.assign({}, currentValues, { servers });
    }
    setErrors((previous: any) => Object.assign({}, previous, { [action.id]: {} }));
    const details = (asArray(action.params) as any[]).map((param) => ({
      label: paramLabel(t, param),
      value: paramDisplayValue(t, param, currentValues),
    }));
    props.openConfirm({
      title: t("act.runTitle", { action: meta.labelKey ? t(meta.labelKey) : action.id }),
      description: t("act.runBody"),
      details,
      confirmLabel: t("act.run"),
      danger: meta.danger === "high" || meta.requiresAdmin === true,
      actionId: action.id,
      params,
    });
  };
  return (
    <div className="dx-section">
      <div className="dx-toolbar">
        <div className="dx-toolbarLeft">
          <SectionHead title={t("act.catalog")} subtitle={String(actions.length)} />
        </div>
        <div className="dx-toolbarRight">
          <span className="dx-small dx-muted">{t("act.footerHint")}</span>
        </div>
      </div>
      {groups.map((group) => {
        const groupActions = actions.filter((action) => action.group === group);
        if (groupActions.length === 0) return null;
        const groupKey = (GROUP_LABEL_KEYS as Record<string, string>)[group];
        return (
          <section className="dx-actionGroup" key={group}>
            <SectionHead title={groupKey ? t(groupKey) : group} subtitle={String(groupActions.length)} />
            <div className="dx-actionGrid">
              {groupActions.map((action) => {
                const meta = actionMetaOf(action);
                return (
                  <ActionCard
                    key={action.id}
                    t={t}
                    action={action}
                    meta={meta}
                    values={asObject(asObject(values)[action.id])}
                    errors={asObject(asObject(errors)[action.id])}
                    pending={pending[action.id] === true}
                    onChange={(name, next) => setActionValue(action.id, name, next)}
                    onRun={runAction}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
      <Card
        title={t("act.history")}
        icon="clock"
        subtitle={history.length > 0 ? String(history.length) : ""}
      >
        {history.length === 0 ? (
          <EmptyState icon="clock" title={t("act.historyEmpty")} />
        ) : (
          <div className="dx-history">
            {history.map((entry: any, index: number) => (
              <div className="dx-historyRow" key={String(entry.ts) + "-" + entry.id + "-" + index}>
                <span className="dx-historyDot" data-tone={entry.ok ? "ok" : "fail"} />
                <div className="dx-historyMain">
                  <div className="dx-historyTop">
                    <span className="dx-historyAction">{actionLabel(t, entry.id)}</span>
                    <span className="dx-historyMeta" title={fmtDateTime(entry.ts)}>
                      {fmtTime(entry.ts)}
                    </span>
                    <Pill tone={entry.ok ? "ok" : "error"}>{entry.ok ? t("act.historyOk") : t("act.historyFail")}</Pill>
                  </div>
                  {entry.message ? <div className="dx-historyMsg">{entry.message}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
