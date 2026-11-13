/** Processes tab: searchable/sortable process table with per-row kill. */
import { Fragment, h } from "../jsx.js";
import { asArray, asObject, fmtBytes, fmtPercent, fmtUptime, isObj, numOr, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { SearchField } from "./SearchField";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ProcessesTabProps {
  t: Translator;
  state?: TabState & { status?: string };
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  onRefresh?: () => void;
  openKill: (target: { pid: number; name: string; signal: string }) => void;
}

export function ProcessesTab(props: ProcessesTabProps) {
  const t = props.t;
  const pending = asObject(props.pending);
  const [search, setSearch] = useState("");
  const [sortDirection, setSortDirection] = useState("desc");
  return (
    <TabShell t={t} state={props.state} skeletonCards={2} onRetry={props.onRetry} errorsKey="proc.errors">
      {(data: any) => {
        const list = asArray(data.list).filter(isObj);
        const query = String(search).trim().toLowerCase();
        const filtered = list
          .filter((process: any) => {
            if (query.length === 0) return true;
            const command = strOr(process.command, "").toLowerCase();
            const user = strOr(process.user, "").toLowerCase();
            return command.indexOf(query) >= 0 || user.indexOf(query) >= 0 || String(process.pid).indexOf(query) >= 0;
          })
          .sort((left: any, right: any) => {
            const first = numOr(left.cpu, -1);
            const second = numOr(right.cpu, -1);
            return sortDirection === "desc" ? second - first : first - second;
          });
        return (
          <div className="dx-section">
            <Card
              title={t("tab.processes")}
              icon="processes"
              subtitle={t("proc.total", { n: numOr(data.total, list.length) })}
              flush
              actions={
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    onClick={() => setSortDirection(sortDirection === "desc" ? "asc" : "desc")}
                    title={t("proc.sortByCpu") + " · " + (sortDirection === "desc" ? t("proc.sortDesc") : t("proc.sortAsc"))}
                    aria-label={t("proc.sortByCpu")}
                  >
                    <Icon name={sortDirection === "desc" ? "arrowDown" : "arrowUp"} size={13} />
                    {sortDirection === "desc" ? t("proc.sortDesc") : t("proc.sortAsc")}
                  </button>
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    disabled={props.state?.status === "loading"}
                    onClick={props.onRefresh}
                    title={t("proc.refresh")}
                    aria-label={t("proc.refresh")}
                  >
                    <Icon name="refresh" size={13} />
                    {t("common.refresh")}
                  </button>
                </div>
              }
            >
              <Fragment>
                <div className="dx-toolbar" style={{ padding: "12px 16px" }}>
                  <div className="dx-toolbarLeft">
                    <SearchField
                      value={String(search)}
                      onChange={setSearch}
                      placeholder={t("proc.search")}
                      label={t("common.search")}
                    />
                  </div>
                  <div className="dx-toolbarRight">
                    <span className="dx-small dx-muted">{String(filtered.length) + " / " + String(list.length)}</span>
                  </div>
                </div>
                <DataTable
                  t={t}
                  scroll="fill"
                  ariaLabel={t("tab.processes")}
                  // The list is re-sorted by CPU on every metrics tick, so an
                  // index key would hand a row's DOM (and its focus/hover
                  // state) to a different process. A pid is the process
                  // identity the Host reports.
                  rowKey={(row: any) => numOr(row.pid, -1)}
                  columns={[
                    { key: "pid", label: t("common.pid"), render: (row: any) => <span className="dx-mono">{String(row.pid)}</span> },
                    {
                      key: "command",
                      label: t("common.process"),
                      render: (row: any) => (
                        <span
                          title={strOr(row.command, "")}
                          style={{
                            display: "inline-block",
                            maxWidth: "360px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            verticalAlign: "bottom",
                          }}
                        >
                          {strOr(row.command, "—")}
                        </span>
                      ),
                    },
                    { key: "user", label: t("common.user"), render: (row: any) => strOr(row.user, "—") },
                    { key: "cpu", label: t("common.cpu"), align: "right", render: (row: any) => fmtPercent(row.cpu, 1) },
                    {
                      key: "memPercent",
                      label: t("common.memory"),
                      align: "right",
                      render: (row: any) => fmtPercent(row.memPercent, 1),
                    },
                    { key: "rssBytes", label: t("proc.rss"), align: "right", render: (row: any) => fmtBytes(row.rssBytes) },
                    { key: "state", label: t("common.state"), render: (row: any) => strOr(row.state, "—") },
                    {
                      key: "elapsed",
                      label: t("proc.elapsed"),
                      // Both hosts report `elapsed` as a number of seconds
                      // (collector-darwin `parseElapsed`, collector-win32's
                      // creation-date delta); render it like every other
                      // duration instead of printing the raw counter.
                      render: (row: any) => fmtUptime(row.elapsed, t),
                    },
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
                          disabled={pending["process.signal"] === true || row.pid === 1}
                          title={t("proc.kill")}
                          aria-label={t("proc.kill") + " PID " + row.pid}
                          onClick={() => props.openKill({ pid: row.pid, name: strOr(row.command, "PID " + row.pid), signal: "TERM" })}
                        >
                          <Icon name="power" size={13} />
                          {t("proc.kill")}
                        </button>
                      ),
                    },
                  ]}
                  rows={filtered}
                  empty={<EmptyState icon="processes" title={t("proc.empty")} />}
                />
              </Fragment>
            </Card>
          </div>
        );
      }}
    </TabShell>
  );
}
