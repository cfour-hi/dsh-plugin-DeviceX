/** Security tab: status cards, TCC/privacy grants, admins and security panes. */
import { Fragment, h } from "../jsx.js";
import { asArray, asObject, boolOrNull, isObj, numOr, strOr } from "../helpers.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { SecurityStatusCard } from "./SecurityStatusCard";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface SecurityTabProps {
  t: Translator;
  platform?: string;
  state?: TabState;
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  openConfirm: (config: Record<string, unknown>) => void;
  openPane: (matchers: string[], fallback: string) => void;
}

export function SecurityTab(props: SecurityTabProps) {
  const t = props.t;
  const pending = asObject(props.pending);
  const isWindows = props.platform === "win32";
  return (
    <TabShell t={t} state={props.state} skeletonCards={4} onRetry={props.onRetry} errorsKey="sec.errors">
      {(data: any) => {
        const fileVault = asObject(data.fileVault);
        const sip = asObject(data.sip);
        const gatekeeper = asObject(data.gatekeeper);
        const firewall = asObject(data.firewall);
        const tcc = asObject(data.tcc);
        const users = asObject(data.users);
        const grants = asArray(tcc.grants).filter(isObj);
        const firewallEnabled = boolOrNull(firewall.enabled);
        const firewallToggleLabel = firewallEnabled === true ? t("sec.toggleFirewallOff") : t("sec.toggleFirewallOn");
        return (
          <div className="dx-section">
            <div className="dx-grid3">
              <SecurityStatusCard
                t={t}
                title={isWindows ? t("sec.bitlocker") : t("sec.fileVault")}
                icon="lock"
                info={fileVault}
              />
              <SecurityStatusCard
                t={t}
                title={isWindows ? t("sec.secureBoot") : t("sec.sip")}
                icon="security"
                info={sip}
              />
              <SecurityStatusCard
                t={t}
                title={isWindows ? t("sec.defender") : t("sec.gatekeeper")}
                icon="firewall"
                info={gatekeeper}
              />
              <SecurityStatusCard
                t={t}
                title={t("sec.firewall")}
                icon="firewall"
                info={firewall}
                extra={
                  <Fragment>
                    {firewall.stealthMode === true || firewall.stealthMode === false ? (
                      <div className="dx-small dx-muted">
                        {t("sec.stealth") + ": " + (firewall.stealthMode ? t("common.on") : t("common.off"))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="dx-btn"
                      data-size="sm"
                      style={{ marginTop: "9px" }}
                      disabled={pending["system.toggleFirewall"] === true}
                      onClick={() =>
                        props.openConfirm({
                          title: firewallEnabled === true ? t("sec.confirmFirewallOff") : t("sec.confirmFirewallOn"),
                          description:
                            firewallEnabled === true ? t("sec.confirmFirewallOffBody") : t("sec.confirmFirewallOnBody"),
                          confirmLabel: firewallToggleLabel,
                          danger: firewallEnabled === true,
                          actionId: "system.toggleFirewall",
                          params: { enabled: firewallEnabled !== true },
                        })
                      }
                    >
                      {firewallToggleLabel}
                    </button>
                  </Fragment>
                }
              />
            </div>
            <Card
              title={t("sec.tcc")}
              icon="users"
              span={2}
              flush={tcc.readable === true}
              actions={
                <button
                  type="button"
                  className="dx-btn"
                  data-size="sm"
                  onClick={() => props.openPane(["privacy", "security"], "privacy")}
                >
                  <Icon name="gear" size={13} />
                  {isWindows ? t("sec.openPrivacyWin") : t("sec.openFileVault")}
                </button>
              }
            >
              {tcc.readable === true ? (
                <DataTable
                  t={t}
                  ariaLabel={t("sec.tcc")}
                  columns={[
                    { key: "service", label: t("sec.service"), render: (row: any) => strOr(row.service, "—") },
                    { key: "client", label: t("sec.client"), render: (row: any) => strOr(row.client, "—") },
                  ]}
                  rows={grants}
                  empty={<EmptyState icon="security" title={t("sec.noGrants")} />}
                />
              ) : (
                <div className="dx-empty">
                  <span className="dx-emptyIcon">
                    <Icon name="lock" size={22} />
                  </span>
                  <p className="dx-emptyTitle">{isWindows ? t("sec.tccUnreadableWin") : t("sec.tccUnreadable")}</p>
                  {tcc.reason ? <p className="dx-emptyText">{t("sec.tccReason", { reason: tcc.reason })}</p> : null}
                </div>
              )}
            </Card>
            <div className="dx-grid2">
              <Card
                title={t("sec.admins")}
                icon="users"
                actions={
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    onClick={() => props.openPane(["users", "accounts"], "users")}
                  >
                    <Icon name="gear" size={13} />
                    {t("sec.openUsers")}
                  </button>
                }
              >
                <div className="dx-tagList">
                  {asArray(users.admins).filter((name) => typeof name === "string").length > 0 ? (
                    (asArray(users.admins).filter((name) => typeof name === "string") as string[]).map((name) => (
                      <Pill key={name} tone={name === strOr(users.current, "") ? "brand" : "idle"}>
                        {name}
                      </Pill>
                    ))
                  ) : (
                    <span className="dx-small dx-muted">{t("sec.noAdmins")}</span>
                  )}
                </div>
                <p className="dx-small dx-muted" style={{ marginTop: "10px" }}>
                  {t("sec.adminsCount", { n: asArray(users.admins).length }) +
                    " · " +
                    t("sec.usersCount", { n: numOr(users.total, 0) })}
                </p>
              </Card>
              <Card title={t("sec.remoteLogin")} icon="network">
                <FactGrid
                  t={t}
                  items={[
                    {
                      key: "remoteLogin",
                      label: t("sec.remoteLogin"),
                      value:
                        data.remoteLogin === true
                          ? t("sec.remoteLoginOn")
                          : data.remoteLogin === false
                            ? t("sec.remoteLoginOff")
                            : t("sec.unknown"),
                    },
                    {
                      key: "autoLogin",
                      label: t("sec.autoLogin"),
                      value:
                        typeof data.autoLogin === "string"
                          ? t("sec.autoLoginUser", { user: data.autoLogin })
                          : t("sec.autoLoginOff"),
                    },
                  ]}
                />
              </Card>
            </div>
            <Card title={t("sec.paneTitle")} icon="gear">
              <div className="dx-toolbar">
                <button
                  type="button"
                  className="dx-btn"
                  onClick={() => props.openPane(["privacy", "security", "filevault"], "privacy")}
                >
                  <Icon name="lock" size={13} />
                  {isWindows ? t("sec.openPrivacyWin") : t("sec.openFileVault")}
                </button>
                <button
                  type="button"
                  className="dx-btn"
                  onClick={
                    isWindows
                      ? () => props.openPane(["windowsdefender", "windowssecurity"], "windowsdefender")
                      : () => props.openPane(["firewall"], "firewall")
                  }
                >
                  <Icon name="firewall" size={13} />
                  {isWindows ? t("sec.openSecurityWin") : t("sec.openFirewall")}
                </button>
                {isWindows ? null : (
                  <button type="button" className="dx-btn" onClick={() => props.openPane(["sharing"], "sharing")}>
                    <Icon name="network" size={13} />
                    {t("sec.openSharing")}
                  </button>
                )}
                <button type="button" className="dx-btn" onClick={() => props.openPane(["users", "accounts"], "users")}>
                  <Icon name="users" size={13} />
                  {t("sec.openUsers")}
                </button>
                <button
                  type="button"
                  className="dx-btn"
                  disabled={pending["system.flushDNS"] === true}
                  onClick={() =>
                    props.openConfirm({
                      title: t("sec.confirmFlushDns"),
                      description: t("sec.confirmFlushDnsBody"),
                      confirmLabel: t("sec.flushDns"),
                      danger: false,
                      actionId: "system.flushDNS",
                      params: {},
                    })
                  }
                >
                  <Icon name="refresh" size={13} />
                  {t("sec.flushDns")}
                </button>
                <button
                  type="button"
                  className="dx-btn"
                  data-variant="danger"
                  disabled={pending["system.emptyTrash"] === true}
                  onClick={() =>
                    props.openConfirm({
                      title: t("sec.confirmEmptyTrash"),
                      description: t("sec.confirmEmptyTrashBody"),
                      confirmLabel: t("sec.emptyTrash"),
                      danger: true,
                      actionId: "system.emptyTrash",
                      params: {},
                    })
                  }
                >
                  <Icon name="trash" size={13} />
                  {t("sec.emptyTrash")}
                </button>
              </div>
            </Card>
          </div>
        );
      }}
    </TabShell>
  );
}
