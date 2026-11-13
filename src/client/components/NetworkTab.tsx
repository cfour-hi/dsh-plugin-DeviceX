/** Network tab: Wi-Fi, DNS, default route, proxy, interfaces and listening ports. */
import { Fragment, h } from "../jsx.js";
import { asArray, asObject, fmtNumber, isFiniteNumber, isObj, numOr, rssiLevel, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { SearchField } from "./SearchField";
import { SegmentedControl } from "./SegmentedControl";
import { SignalBars } from "./SignalBars";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

/** Protocol bucket for one listener row (`tcp`, `tcp6`, `udp6` … → tcp/udp). */
function protoBucket(value: unknown) {
  const text = strOr(value, "").toLowerCase();
  if (text.indexOf("tcp") === 0) return "tcp";
  if (text.indexOf("udp") === 0) return "udp";
  return "other";
}

const NET_TYPE_KEYS: Record<string, string> = {
  wifi: "net.type.wifi",
  ethernet: "net.type.ethernet",
  loopback: "net.type.loopback",
  bridge: "net.type.bridge",
  other: "net.type.other",
};

/** Rows rendered per "show more" step for the listening-port table.
 *
 * 100 covers an ordinary desktop (a few dozen listeners), so the control only
 * appears on a host that really reports hundreds of sockets (containers,
 * proxies, a dev machine with many servers). */
const PORT_PAGE_SIZE = 100;

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
  // A busy host exposes hundreds of listeners; the card shows a bounded,
  // searchable, protocol-filtered page instead of one very long table.
  const [portQuery, setPortQuery] = useState("");
  const [portProto, setPortProto] = useState("all");
  const [portLimit, setPortLimit] = useState(PORT_PAGE_SIZE);
  return (
    <TabShell t={t} state={props.state} skeletonCards={4} onRetry={props.onRetry} errorsKey="net.errors">
      {(data: any) => {
        const interfaces = asArray(data.interfaces).filter(isObj);
        const wifi = isObj(data.wifi) ? data.wifi : null;
        const defaultRoute = isObj(data.defaultRoute) ? data.defaultRoute : null;
        const dns = asObject(data.dns);
        const proxy = asObject(data.proxy);
        const ports = asArray(data.listeningPorts).filter(isObj);
        const portNeedle = String(portQuery).trim().toLowerCase();
        const filteredPorts = ports.filter((entry: any) => {
          if (portProto !== "all" && protoBucket(entry.proto) !== portProto) return false;
          if (portNeedle.length === 0) return true;
          const haystack = [entry.proto, entry.address, entry.port, entry.pid, entry.process]
            .filter((value) => value !== null && value !== undefined)
            .map((value) => String(value).toLowerCase());
          return haystack.some((value) => value.indexOf(portNeedle) >= 0);
        });
        const visiblePorts = filteredPorts.slice(0, portLimit);
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
              {ports.length === 0 ? (
                <EmptyState title={t("net.noPorts")} />
              ) : (
                <Fragment>
                  <div className="dx-toolbar" style={{ padding: "12px 16px" }}>
                    <div className="dx-toolbarLeft">
                      <SearchField
                        value={String(portQuery)}
                        onChange={(value) => {
                          setPortQuery(value);
                          setPortLimit(PORT_PAGE_SIZE);
                        }}
                        placeholder={t("net.portsSearch")}
                        label={t("common.search")}
                      />
                    </div>
                    <div className="dx-toolbarRight">
                      <SegmentedControl
                        label={t("net.portsFilter")}
                        options={[
                          { value: "all", label: t("common.all") },
                          { value: "tcp", label: "TCP" },
                          { value: "udp", label: "UDP" },
                        ]}
                        value={String(portProto)}
                        onChange={(value) => {
                          setPortProto(value);
                          setPortLimit(PORT_PAGE_SIZE);
                        }}
                      />
                      <span className="dx-small dx-muted" title={t("net.portsTotal", { total: ports.length })}>
                        {String(visiblePorts.length) + " / " + String(filteredPorts.length)}
                      </span>
                    </div>
                  </div>
                  <DataTable
                    t={t}
                    // Bounded scrollport (sticky header stays pinned) so a busy
                    // host cannot stretch the whole panel.
                    scroll
                    ariaLabel={t("net.ports")}
                    // Search, the protocol filter and "show more" all reshuffle
                    // this list, so identify a socket by its 4-tuple instead of
                    // its position on the page.
                    rowKey={(row: any) =>
                      strOr(row.proto, "") +
                      ":" +
                      strOr(row.address, "") +
                      ":" +
                      String(numOr(row.port, -1)) +
                      ":" +
                      String(numOr(row.pid, -1))
                    }
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
                    rows={visiblePorts}
                    empty={<EmptyState icon="search" title={t("net.noPortsMatch")} />}
                  />
                  {visiblePorts.length < filteredPorts.length ? (
                    <div className="dx-toolbar" style={{ padding: "10px 16px", justifyContent: "center" }}>
                      <button
                        type="button"
                        className="dx-btn"
                        data-size="sm"
                        onClick={() => setPortLimit(portLimit + PORT_PAGE_SIZE)}
                      >
                        {t("net.portsMore", { n: Math.min(PORT_PAGE_SIZE, filteredPorts.length - visiblePorts.length) })}
                      </button>
                    </div>
                  ) : null}
                </Fragment>
              )}
            </Card>
          </div>
        );
      }}
    </TabShell>
  );
}
