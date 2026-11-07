/** System tab: OS/device/boot/locale facts, users, startup items, login items, environment. */
import { h } from "../jsx.js";
import { asArray, asObject, fmtDateTime, fmtUptime, isFiniteNumber, isObj, strOr } from "../helpers.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Pill } from "./Pill";
import { Switch } from "./Switch";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const ENV_KEYS = ["PATH", "SHELL", "HOME", "USER", "LANG", "TERM"];
const AGENT_SCOPE_KEYS: Record<string, string> = { user: "sys.userScope", system: "sys.systemScope" };

export interface SystemTabProps {
  t: Translator;
  platform?: string;
  state?: TabState;
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  openConfirm?: (config: Record<string, unknown>) => void;
}

export function SystemTab(props: SystemTabProps) {
  const t = props.t;
  const isWindows = props.platform === "win32";
  const pending = asObject(props.pending);
  const agentPending = pending["system.launchAgent"] === true;
  return (
    <TabShell t={t} state={props.state} skeletonCards={4} onRetry={props.onRetry} errorsKey="sys.errors">
      {(data: any) => {
        const os = asObject(data.os);
        const device = asObject(data.device);
        const boot = asObject(data.boot);
        const currentUser = asObject(data.user);
        const users = asArray(data.users).filter(isObj);
        const launchAgents = asArray(data.launchAgents).filter(isObj);
        const loginItems = asArray(data.loginItems).filter(isObj);
        const environment = asObject(data.environment);
        const locale = asObject(data.locale);
        const facts = [
          os.name || os.version
            ? { key: "name", label: t("sys.name"), value: strOr(os.name, "—") + (os.version ? " " + os.version : "") }
            : null,
          os.build ? { key: "build", label: t("sys.build"), value: os.build } : null,
          os.kernel ? { key: "kernel", label: t("sys.kernel"), value: os.kernel } : null,
          os.arch ? { key: "arch", label: t("sys.arch"), value: os.arch } : null,
        ].filter(Boolean) as any;
        const deviceFacts = [
          device.hostname ? { key: "hostname", label: t("sys.hostname"), value: device.hostname } : null,
          device.computerName ? { key: "computerName", label: t("sys.computerName"), value: device.computerName } : null,
          device.localHostname ? { key: "localHostname", label: t("sys.localHostname"), value: device.localHostname } : null,
          device.model ? { key: "model", label: t("sys.model"), value: device.model } : null,
          device.modelId ? { key: "modelId", label: t("sys.modelId"), value: device.modelId } : null,
          device.chip ? { key: "chip", label: t("sys.chip"), value: device.chip } : null,
          device.serial ? { key: "serial", label: t("sys.serial"), value: device.serial } : null,
          device.hardwareUuid ? { key: "uuid", label: t("sys.hardwareUuid"), value: device.hardwareUuid } : null,
        ].filter(Boolean) as any;
        const bootFacts = [
          isFiniteNumber(boot.bootTime) ? { key: "bootTime", label: t("sys.bootTime"), value: fmtDateTime(boot.bootTime) } : null,
          boot.uptimeSec !== null && boot.uptimeSec !== undefined
            ? { key: "uptime", label: t("sys.uptime"), value: fmtUptime(boot.uptimeSec, t) }
            : null,
        ].filter(Boolean) as any;
        const userFacts = [
          currentUser.name ? { key: "name", label: t("sys.currentUser"), value: currentUser.name } : null,
          currentUser.fullName ? { key: "fullName", label: t("sys.fullName"), value: currentUser.fullName } : null,
          currentUser.shell ? { key: "shell", label: t("sys.shell"), value: currentUser.shell } : null,
          currentUser.home ? { key: "home", label: t("sys.home"), value: currentUser.home } : null,
          currentUser.uid !== null && currentUser.uid !== undefined
            ? { key: "uid", label: t("sys.uid"), value: String(currentUser.uid) }
            : null,
        ].filter(Boolean) as any;
        const localeFacts = [
          locale.timezone ? { key: "timezone", label: t("sys.timezone"), value: locale.timezone } : null,
          locale.language ? { key: "language", label: t("sys.language"), value: locale.language } : null,
          locale.locale ? { key: "locale", label: t("sys.localeValue"), value: locale.locale } : null,
          isFiniteNumber(currentUser.uid) ? { key: "uid", label: t("sys.uid"), value: String(currentUser.uid) } : null,
        ].filter(Boolean) as any;
        const envRows = ENV_KEYS.filter((key) => typeof environment[key] === "string" && environment[key].length > 0).map((key) => ({
          key,
          value: environment[key],
        }));
        const agentRows = launchAgents.slice(0, 200);
        return (
          <div className="dx-section">
            <div className="dx-grid2">
              <Card title={t("sys.os")} icon="system">
                <FactGrid t={t} items={facts} emptyText={t("common.empty")} />
              </Card>
              <Card title={t("sys.device")} icon="cpu">
                <FactGrid t={t} items={deviceFacts} emptyText={t("common.empty")} />
              </Card>
              <Card title={t("sys.boot")} icon="boot">
                <FactGrid t={t} items={bootFacts} emptyText={t("common.empty")} />
              </Card>
              <Card title={t("sys.locale")} icon="locale">
                <FactGrid t={t} items={localeFacts} emptyText={t("common.empty")} />
              </Card>
            </div>
            <Card
              title={t("sys.users")}
              icon="users"
              subtitle={
                currentUser.admin === true
                  ? t("sys.currentUser") + " · " + t("common.admin")
                  : t("sys.currentUser") + " · " + strOr(currentUser.name, "—")
              }
              flush
            >
              <DataTable
                t={t}
                ariaLabel={t("sys.users")}
                columns={[
                  { key: "name", label: t("common.user"), render: (row: any) => strOr(row.name, "—") },
                  { key: "fullName", label: t("sys.fullName"), render: (row: any) => strOr(row.fullName, "—") },
                  {
                    key: "uid",
                    label: t("sys.uid"),
                    render: (row: any) => (row.uid === null || row.uid === undefined ? "—" : String(row.uid)),
                  },
                  {
                    key: "gid",
                    label: t("sys.gid"),
                    render: (row: any) => (row.gid === null || row.gid === undefined ? "—" : String(row.gid)),
                  },
                  {
                    key: "admin",
                    label: t("common.admin"),
                    render: (row: any) =>
                      row.admin === true ? <Pill tone="brand">{t("common.admin")}</Pill> : <span className="dx-muted">—</span>,
                  },
                  {
                    key: "current",
                    label: t("common.current"),
                    render: (row: any) =>
                      row.isCurrent === true ? <Pill tone="ok">{t("common.current")}</Pill> : <span className="dx-muted">—</span>,
                  },
                ]}
                rows={users}
                empty={<EmptyState title={t("common.empty")} />}
              />
            </Card>
            <Card
              title={isWindows ? t("sys.startupItems") : t("sys.launchAgents")}
              icon="agent"
              subtitle={String(launchAgents.length)}
              flush
              actions={agentPending ? <span className="dx-pill" data-tone="brand">{t("common.pending")}</span> : null}
            >
              <DataTable
                t={t}
                ariaLabel={isWindows ? t("sys.startupItems") : t("sys.launchAgents")}
                columns={[
                  { key: "label", label: t("common.name"), render: (row: any) => strOr(row.label, "—") },
                  {
                    key: "scope",
                    label: t("sys.scope"),
                    render: (row: any) => {
                      const scopeKey = AGENT_SCOPE_KEYS[strOr(row.scope, "")];
                      return <Pill tone={row.scope === "system" ? "warn" : "idle"}>{scopeKey ? t(scopeKey) : strOr(row.scope, "—")}</Pill>;
                    },
                  },
                  {
                    key: "loaded",
                    label: t("sys.loaded"),
                    render: (row: any) =>
                      typeof row.path === "string" && row.path.length > 0 ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <Switch
                            checked={row.loaded === true}
                            disabled={agentPending}
                            label={strOr(row.label, t("sys.launchAgents"))}
                            onChange={() =>
                              props.openConfirm?.({
                                title: t(row.loaded === true ? "sys.agentConfirmDisable" : "sys.agentConfirmEnable", {
                                  label: strOr(row.label, "—"),
                                }),
                                confirmLabel: t(row.loaded === true ? "sys.disableAgent" : "sys.enableAgent"),
                                danger: false,
                                actionId: "system.launchAgent",
                                params: { path: row.path, enabled: row.loaded !== true },
                              })
                            }
                          />
                          <span className="dx-muted dx-small">{row.loaded === true ? t("common.enabled") : t("common.disabled")}</span>
                        </span>
                      ) : (
                        <span className="dx-muted">—</span>
                      ),
                  },
                  {
                    key: "pid",
                    label: t("common.pid"),
                    render: (row: any) => (row.pid === null || row.pid === undefined ? "—" : String(row.pid)),
                  },
                  {
                    key: "exit",
                    label: t("sys.lastExit"),
                    render: (row: any) =>
                      row.lastExitStatus === null || row.lastExitStatus === undefined ? "—" : String(row.lastExitStatus),
                  },
                  { key: "program", label: t("sys.program"), render: (row: any) => strOr(row.program, "—") },
                ]}
                rows={agentRows}
                empty={<EmptyState title={t("sys.noAgents")} />}
              />
            </Card>
            <div className="dx-grid2">
              <Card title={t("sys.loginItems")} icon="boot">
                {loginItems.length === 0 ? (
                  <EmptyState title={t("sys.noLoginItems")} />
                ) : (
                  <div className="dx-tagList">
                    {loginItems.slice(0, 40).map((item: any, index: number) => (
                      <Pill key={index} tone="idle">
                        {strOr(item.name, "—")}
                      </Pill>
                    ))}
                  </div>
                )}
              </Card>
              <Card title={t("sys.environment")} icon="env" subtitle={t("sys.envNote")} flush>
                <DataTable
                  t={t}
                  columns={[
                    { key: "key", label: t("common.name"), render: (row: any) => <span className="dx-mono">{row.key}</span> },
                    {
                      key: "value",
                      label: t("common.value"),
                      cellClass: "dx-tdWrap",
                      render: (row: any) => (
                        <span className="dx-mono" title={row.value}>
                          {row.value}
                        </span>
                      ),
                    },
                  ]}
                  rows={envRows}
                  empty={<EmptyState title={t("common.empty")} />}
                />
              </Card>
            </div>
          </div>
        );
      }}
    </TabShell>
  );
}
