/** Network tab: Wi-Fi, DNS, default route, proxy, interfaces and listening ports. */
import { Fragment, h } from "../jsx.js";
import { asArray, asObject, fmtNumber, isFiniteNumber, isObj, rssiLevel, strOr } from "../helpers.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { SignalBars } from "./SignalBars";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const NET_TYPE_KEYS: Record<string, string> = {
  wifi: "net.type.wifi",
  ethernet: "net.type.ethernet",
  loopback: "net.type.loopback",
  bridge: "net.type.bridge",
  other: "net.type.other",
};

export interface NetworkTabProps {
  t: Translator;
  state?: TabState;
  pending?: Record<string, unknown>;
  onRetry?: () => void;
  openConfirm: (config: Record<string, unknown>) => void;
  openDns: (service: string, servers: string[]) => void;
  openPane: (matchers: string[], fallback: string) => void;
}

export function NetworkTab(props: NetworkTabProps) {
  const t = props.t;
  const pending = asObject(props.pending);
  return (
    <TabShell t={t} state={props.state} skeletonCards={4} onRetry={props.onRetry} errorsKey="net.errors">
      {(data: any) => {
        const interfaces = asArray(data.interfaces).filter(isObj);
        const wifi = isObj(data.wifi) ? data.wifi : null;
        const defaultRoute = isObj(data.defaultRoute) ? data.defaultRoute : null;
        const dns = asObject(data.dns);
        const proxy = asObject(data.proxy);
        const ports = asArray(data.listeningPorts).filter(isObj);
        const wifiInterface = interfaces.find((entry: any) => entry.type === "wifi");
        const wifiOn = wifiInterface ? wifiInterface.up !== false : wifi !== null;
        const wifiPowerLabel = wifiOn ? t("net.wifiPowerOn") : t("net.wifiPowerOff");
        const serviceName = defaultRoute && defaultRoute.interface ? defaultRoute.interface : "Wi-Fi";
        const dnsServers = asArray(dns.servers).filter((entry) => typeof entry === "string") as string[];
        const searchDomains = asArray(dns.searchDomains).filter((entry) => typeof entry === "string") as string[];
        const proxyRows = [
          { key: "http", label: t("net.http") },
          { key: "https", label: t("net.https") },
          { key: "socks", label: t("net.socks") },
        ];
        return (
          <div className="dx-section">
            <div className="dx-grid2">
              <Card
                title={t("net.wifi")}
                icon="wifi"
                actions={
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    disabled={pending["network.setWifiPower"] === true}
                    onClick={() =>
                      props.openConfirm({
                        title: wifiOn ? t("net.confirmWifiOff") : t("net.confirmWifiOn"),
                        confirmLabel: wifiPowerLabel,
                        danger: wifiOn,
                        actionId: "network.setWifiPower",
                        params: { enabled: !wifiOn },
                      })
                    }
                  >
                    <Icon name="wifi" size={13} />
                    {wifiPowerLabel}
                  </button>
                }
              >
                {wifi ? (
                  <Fragment>
                    <div className="dx-toolbar" style={{ gap: "12px", marginBottom: "10px" }}>
                      <SignalBars level={rssiLevel(wifi.rssi)} label={t("net.signalLevel", { level: rssiLevel(wifi.rssi) })} />
                      <span style={{ fontWeight: 600 }}>{strOr(wifi.ssid, "—")}</span>
                      <span className="dx-small dx-muted">
                        {isFiniteNumber(wifi.rssi) ? String(Math.round(wifi.rssi)) + " dBm" : ""}
                      </span>
                    </div>
                    <FactGrid
                      t={t}
                      items={[
                        wifi.bssid ? { key: "bssid", label: t("net.bssid"), value: wifi.bssid } : null,
                        wifi.channel !== null && wifi.channel !== undefined
                          ? { key: "channel", label: t("net.channel"), value: String(wifi.channel) }
                          : null,
                        wifi.security ? { key: "security", label: t("net.security"), value: wifi.security } : null,
                        wifi.txRateMbps !== null && wifi.txRateMbps !== undefined
                          ? { key: "txRate", label: t("net.txRate"), value: fmtNumber(wifi.txRateMbps) + " Mbps" }
                          : null,
                        wifi.noise !== null && wifi.noise !== undefined
                          ? { key: "noise", label: t("net.noise"), value: String(wifi.noise) + " dBm" }
                          : null,
                      ].filter(Boolean) as any}
                      emptyText={t("common.empty")}
                    />
                  </Fragment>
                ) : (
                  <EmptyState icon="wifi" title={t("net.notConnected")} text={wifiPowerLabel} />
                )}
              </Card>
              <Card
                title={t("net.dns")}
                icon="network"
                actions={
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    disabled={pending["network.setDns"] === true}
                    onClick={() => props.openDns(serviceName, dnsServers)}
                  >
                    <Icon name="gear" size={13} />
                    {t("net.setDns")}
                  </button>
                }
              >
                {dnsServers.length === 0 ? (
                  <EmptyState icon="network" title={t("net.none")} />
                ) : (
                  <div className="dx-tagList">
                    {dnsServers.map((server) => (
                      <Pill key={server} tone="idle">
                        <span className="dx-mono">{server}</span>
                      </Pill>
                    ))}
                  </div>
                )}
                {searchDomains.length > 0 ? (
                  <div className="dx-subcardMeta" style={{ marginTop: "10px" }}>
                    {t("net.searchDomains") + ": " + searchDomains.join(", ")}
                  </div>
                ) : null}
              </Card>
              <Card
                title={t("net.route")}
                icon="network"
                actions={
                  <button
                    type="button"
                    className="dx-btn"
                    data-size="sm"
                    onClick={() => props.openPane(["network"], "network")}
                  >
                    <Icon name="gear" size={13} />
                    {t("net.openSettings")}
                  </button>
                }
              >
                <FactGrid
                  t={t}
                  items={[
                    defaultRoute && defaultRoute.gateway
                      ? { key: "gateway", label: t("net.gateway"), value: defaultRoute.gateway }
                      : null,
                    defaultRoute && defaultRoute.interface
                      ? { key: "interface", label: t("net.interface"), value: defaultRoute.interface }
                      : null,
                  ].filter(Boolean) as any}
                  emptyText={t("net.none")}
                />
              </Card>
              <Card title={t("net.proxy")} icon="env">
                <FactGrid
                  t={t}
                  items={proxyRows.map((row) => ({
                    key: row.key,
                    label: row.label,
                    value:
                      proxy[row.key] === null || proxy[row.key] === undefined || proxy[row.key] === ""
                        ? t("net.none")
                        : String(proxy[row.key]),
                  }))}
                />
              </Card>
            </div>
            <Card title={t("net.interfaces")} icon="network" flush subtitle={String(interfaces.length)}>
              <DataTable
                t={t}
                ariaLabel={t("net.interfaces")}
                columns={[
                  {
                    key: "name",
                    label: t("net.interface"),
                    render: (row: any) => (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
                        <span className="dx-mono">{strOr(row.name, "—")}</span>
                        {row.primary === true ? <Pill tone="brand">{t("net.primary")}</Pill> : null}
                      </span>
                    ),
                  },
                  {
                    key: "type",
                    label: t("common.type"),
                    render: (row: any) => {
                      const key = NET_TYPE_KEYS[strOr(row.type, "other")];
                      return <Pill tone="idle">{key ? t(key) : strOr(row.type, "—")}</Pill>;
                    },
                  },
                  {
                    key: "up",
                    label: t("common.status"),
                    render: (row: any) =>
                      row.up === true ? (
                        <Pill tone="ok">{t("net.up")}</Pill>
                      ) : row.up === false ? (
                        <Pill tone="idle">{t("net.down")}</Pill>
                      ) : (
                        <Pill tone="idle">{t("common.unknown")}</Pill>
                      ),
                  },
                  {
                    key: "ipv4",
                    label: t("net.ipv4"),
                    render: (row: any) => (asArray(row.ipv4).length > 0 ? asArray(row.ipv4).join(", ") : t("net.ipNone")),
                  },
                  {
                    key: "ipv6",
                    label: t("net.ipv6"),
                    render: (row: any) => (asArray(row.ipv6).length > 0 ? asArray(row.ipv6).join(", ") : t("net.ipNone")),
                  },
                  { key: "mac", label: t("net.mac"), render: (row: any) => <span className="dx-mono">{strOr(row.mac, "—")}</span> },
                  {
                    key: "mtu",
                    label: t("net.mtu"),
                    render: (row: any) => (row.mtu === null || row.mtu === undefined ? "—" : String(row.mtu)),
                  },
                ]}
                rows={interfaces}
                empty={<EmptyState title={t("net.noInterfaces")} />}
              />
            </Card>
            <Card
              title={t("net.ports")}
              icon="signal"
              subtitle={
                t("net.established") +
                ": " +
                (data.establishedCount === null || data.establishedCount === undefined
                  ? "—"
                  : t("net.establishedCount", { n: data.establishedCount }))
              }
              flush
            >
              <DataTable
                t={t}
                ariaLabel={t("net.ports")}
                columns={[
                  {
                    key: "proto",
                    label: t("net.proto"),
                    render: (row: any) => <span className="dx-mono">{strOr(row.proto, "—").toUpperCase()}</span>,
                  },
                  { key: "address", label: t("common.address"), render: (row: any) => <span className="dx-mono">{strOr(row.address, "—")}</span> },
                  {
                    key: "port",
                    label: t("common.port"),
                    render: (row: any) => (
                      <span className="dx-mono">{row.port === null || row.port === undefined ? "—" : String(row.port)}</span>
                    ),
                  },
                  {
                    key: "pid",
                    label: t("common.pid"),
                    render: (row: any) => (row.pid === null || row.pid === undefined ? "—" : String(row.pid)),
                  },
                  { key: "process", label: t("common.process"), render: (row: any) => strOr(row.process, "—") },
                ]}
                rows={ports}
                empty={<EmptyState title={t("net.noPorts")} />}
              />
            </Card>
          </div>
        );
      }}
    </TabShell>
  );
}
