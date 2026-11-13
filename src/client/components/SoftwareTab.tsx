/** Software tab: searchable applications table + Homebrew / winget card. */
import { Fragment, h } from "../jsx.js";
import { asArray, asObject, fmtBytes, fmtDateTime, isFiniteNumber, isObj, numOr, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { SearchField } from "./SearchField";
import { SegmentedControl } from "./SegmentedControl";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";
import { Tooltip } from "./Tooltip";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const SW_SOURCE_KEYS: Record<string, string> = {
  system: "sw.source.system",
  user: "sw.source.user",
  other: "sw.source.other",
};

export interface SoftwareTabProps {
  t: Translator;
  platform?: string;
  state?: TabState;
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  onAction: (id: string, params?: Record<string, unknown>) => Promise<any>;
  openConfirm: (config: Record<string, unknown>) => void;
  /**
   * Open the uninstall dialog. The host scans first; if the scan fails the page
   * falls back to the plain confirm, so this never blocks uninstalling.
   */
  openUninstall?: (target: { path: string; name: string; uninstallId: string }) => void;
}

export function SoftwareTab(props: SoftwareTabProps) {
  const t = props.t;
  const pending = asObject(props.pending);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortDirection, setSortDirection] = useState("asc");
  const [view, setView] = useState("apps");
  const viewOptions = [
    { value: "apps", label: t("sw.applications") },
    { value: "packages", label: props.platform === "win32" ? t("sw.winget") : t("sw.homebrew") },
  ];
  const sourceOptions = [
    { value: "all", label: t("common.all") },
    { value: "system", label: t("sw.source.system") },
    { value: "user", label: t("sw.source.user") },
    { value: "other", label: t("sw.source.other") },
  ];
  return (
    <TabShell t={t} state={props.state} skeletonCards={3} onRetry={props.onRetry} errorsKey="sw.errors">
      {(data: any) => {
        const homebrew = asObject(data.homebrew);
        const winget = asObject(data.winget);
        const isWindows = props.platform === "win32";
        const viewSwitch = (
          <SegmentedControl label={t("sw.view")} options={viewOptions} value={view} onChange={setView} />
        );
        const applications = asArray(data.applications).filter(isObj);
        const query = String(search).trim().toLowerCase();
        const filtered = applications
          .filter((application: any) => {
            const name = strOr(application.name, "").toLowerCase();
            const bundleId = strOr(application.bundleId, "").toLowerCase();
            const matchesQuery = query.length === 0 || name.indexOf(query) >= 0 || bundleId.indexOf(query) >= 0;
            const source = strOr(application.source, "other");
            const matchesSource = sourceFilter === "all" || source === sourceFilter;
            return matchesQuery && matchesSource;
          })
          .sort((left: any, right: any) => {
            const first = strOr(left.name, "").toLowerCase();
            const second = strOr(right.name, "").toLowerCase();
            return sortDirection === "asc" ? first.localeCompare(second) : second.localeCompare(first);
          });
        const installed = asArray(homebrew.installed).filter(isObj);
        const outdated = asArray(homebrew.outdated);
        return (
          <div className="dx-section">
            {view === "apps" ? (
            <Card
              title={t("sw.applications")}
              icon="software"
              subtitle={t("sw.appCount", { n: numOr(data.totalApplications, applications.length) })}
              actions={viewSwitch}
              flush
            >
              <Fragment>
                <div className="dx-toolbar" style={{ padding: "12px 16px" }}>
                  <div className="dx-toolbarLeft">
                    <SearchField
                      value={String(search)}
                      onChange={setSearch}
                      placeholder={t("sw.search")}
                      label={t("common.search")}
                    />
                  </div>
                  <div className="dx-toolbarRight">
                    <SegmentedControl
                      label={t("sw.sourceFilter")}
                      options={sourceOptions}
                      value={String(sourceFilter)}
                      onChange={setSourceFilter}
                    />
                    <span className="dx-small dx-muted">
                      {installed.length > 0
                        ? String(installed.length) + " / " + String(applications.length)
                        : String(applications.length)}
                    </span>
                    <button
                      type="button"
                      className="dx-btn"
                      data-size="sm"
                      onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                      title={sortDirection === "asc" ? t("sw.sortAsc") : t("sw.sortDesc")}
                      aria-label={t("sw.sortName")}
                    >
                      <Icon name={sortDirection === "asc" ? "arrowUp" : "arrowDown"} size={13} />
                      {sortDirection === "asc" ? t("sw.sortAsc") : t("sw.sortDesc")}
                    </button>
                  </div>
                </div>
                <DataTable
                  t={t}
                  scroll="fill"
                  ariaLabel={t("sw.applications")}
                  // Search and the name sort reorder this list, so key on the
                  // bundle path (unique per installed app) rather than the
                  // array index. Fall back to name@version for rows the Host
                  // reports without a path.
                  rowKey={(row: any) => strOr(row.path, "") || strOr(row.name, "") + "@" + strOr(row.version, "")}
                  columns={[
                    {
                      key: "name",
                      label: t("common.name"),
                      render: (row: any) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {strOr(row.name, "—")}
                          </div>
                          {row.bundleId ? <div className="dx-small dx-muted">{row.bundleId}</div> : null}
                        </div>
                      ),
                    },
                    { key: "version", label: t("common.version"), render: (row: any) => strOr(row.version, "—") },
                    {
                      key: "source",
                      label: t("common.source"),
                      render: (row: any) => {
                        const source = strOr(row.source, "other");
                        const key = SW_SOURCE_KEYS[source];
                        return <Pill tone={source === "user" ? "brand" : "idle"}>{key ? t(key) : source}</Pill>;
                      },
                    },
                    { key: "arch", label: t("sw.arch"), render: (row: any) => strOr(row.arch, "—") },
                    { key: "size", label: t("sw.size"), render: (row: any) => fmtBytes(row.sizeBytes) },
                    {
                      key: "lastUsed",
                      label: t("sw.lastUsed"),
                      render: (row: any) =>
                        isFiniteNumber(row.lastUsed) && row.lastUsed > 0 ? fmtDateTime(row.lastUsed) : t("common.never"),
                    },
                    {
                      key: "actions",
                      label: t("common.actions"),
                      align: "right",
                      render: (row: any) => {
                        const path = strOr(row.path, "");
                        const uninstallId = strOr(row.uninstallId, "");
                        const isSystemApp = strOr(row.source, "") === "system" || path.indexOf("/System/") === 0;
                        const canUninstall = isWindows
                          ? uninstallId.length > 0 || (path.length > 0 && !isSystemApp)
                          : path.length > 0 && !isSystemApp;
                        return (
                          <div className="dx-rowActions">
                            <button
                              type="button"
                              className="dx-btn"
                              data-size="sm"
                              disabled={!path || pending["app.reveal"] === true}
                              title={isWindows ? t("sw.revealWin") : t("sw.reveal")}
                              aria-label={(isWindows ? t("sw.revealWin") : t("sw.reveal")) + " " + strOr(row.name, "")}
                              onClick={() => props.onAction("app.reveal", { path })}
                            >
                              <Icon name="reveal" size={13} />
                            </button>
                            <button
                              type="button"
                              className="dx-btn"
                              data-size="sm"
                              data-variant="danger"
                              disabled={!canUninstall || pending["app.uninstall"] === true}
                              title={isSystemApp ? t("sw.systemAppNote") : t("sw.uninstall")}
                              aria-label={t("sw.uninstall") + " " + strOr(row.name, "")}
                              onClick={() => {
                                if (props.openUninstall) {
                                  props.openUninstall({ path, name: strOr(row.name, "—"), uninstallId });
                                  return;
                                }
                                props.openConfirm({
                                  title: t("sw.uninstallTitle", { name: strOr(row.name, "—") }),
                                  description: uninstallId.length > 0 ? t("sw.uninstallBodyWin") : t("sw.uninstallBody"),
                                  confirmLabel: t("sw.uninstall"),
                                  danger: true,
                                  actionId: "app.uninstall",
                                  params: { path, id: uninstallId, mode: "trash" },
                                });
                              }}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        );
                      },
                    },
                  ]}
                  rows={filtered}
                  empty={
                    // `empty` only renders when the *filtered* list is empty, and
                    // TabShell owns the loading state (skeleton), so "still
                    // reading" was never true here. Distinguish "the Host
                    // reported no applications" from "nothing matched".
                    <EmptyState
                      icon="software"
                      title={applications.length === 0 ? t("sw.noAppsInstalled") : t("sw.noApps")}
                    />
                  }
                />
              </Fragment>
            </Card>
            ) : (
            <Card
              title={isWindows ? t("sw.winget") : t("sw.homebrew")}
              icon="database"
              actions={viewSwitch}
              badge={
                !isWindows && outdated.length > 0 ? (
                  <Tooltip
                    label={
                      t("sw.brewOutdated") +
                      ": " +
                      outdated
                        .slice(0, 12)
                        .map((entry: any) => (typeof entry === "string" ? entry : strOr(asObject(entry).name, "")))
                        .filter(Boolean)
                        .join(", ") +
                      (outdated.length > 12 ? " …" : "")
                    }
                  >
                    <Pill tone="warn">{t("sw.brewOutdated") + " " + String(outdated.length)}</Pill>
                  </Tooltip>
                ) : null
              }
              subtitle={
                isWindows
                  ? winget.available === true
                    ? t("sw.wingetAvailable") + (strOr(winget.version, "") ? " · " + strOr(winget.version, "") : "")
                    : t("sw.wingetUnavailable")
                  : homebrew.available === true
                    ? strOr(homebrew.prefix, "")
                    : t("sw.brewNotAvailable")
              }
              flush
            >
              {isWindows ? (
                <EmptyState
                  icon="database"
                  title={winget.available === true ? t("sw.wingetHint") : t("sw.wingetUnavailable")}
                />
              ) : homebrew.available !== true ? (
                <EmptyState icon="database" title={t("sw.brewNotAvailable")} />
              ) : (
                <DataTable
                  t={t}
                  scroll="fill"
                  ariaLabel={t("sw.homebrew")}
                  columns={[
                    { key: "name", label: t("common.name"), render: (row: any) => <span className="dx-mono">{strOr(row.name, "—")}</span> },
                    { key: "version", label: t("common.version"), render: (row: any) => <span className="dx-mono">{strOr(row.version, "—")}</span> },
                    {
                      key: "actions",
                      label: t("common.actions"),
                      align: "right",
                      render: (row: any) => (
                        <button
                          type="button"
                          className="dx-btn"
                          data-size="sm"
                          data-variant="danger"
                          disabled={pending["software.brewUninstall"] === true}
                          onClick={() =>
                            props.openConfirm({
                              title: t("sw.brewConfirmTitle", { name: strOr(row.name, "—") }),
                              description: t("sw.brewConfirmBody", { name: strOr(row.name, "—") }),
                              confirmLabel: t("sw.brewUninstall"),
                              danger: true,
                              actionId: "software.brewUninstall",
                              params: { name: strOr(row.name, "") },
                            })
                          }
                        >
                          {t("sw.brewUninstall")}
                        </button>
                      ),
                    },
                  ]}
                  rows={installed}
                  empty={<EmptyState icon="database" title={t("sw.noBrew")} />}
                />
              )}
            </Card>
            )}
          </div>
        );
      }}
    </TabShell>
  );
}
