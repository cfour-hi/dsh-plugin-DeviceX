/** Overview tab: hero scene, derived alerts, KPI ring grid, top processes and memory breakdown. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import {
  asArray,
  asObject,
  clamp,
  fmtBytes,
  fmtNumber,
  fmtPercent,
  fmtRate,
  fmtUptime,
  isFiniteNumber,
  numOr,
  percentOf,
  pressureKey,
  pressureTone,
  rssiLevel,
  usageTone,
} from "../helpers.js";
import { Card } from "./Card";
import { DeviceScene } from "./DeviceScene";
import { Donut } from "./Donut";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { KpiCard } from "./KpiCard";
import { SignalBars } from "./SignalBars";
import { Skeleton } from "./Skeleton";
import { Sparkline } from "./Sparkline";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface OverviewTabProps {
  t: Translator;
  metrics?: any;
  samples?: Record<string, unknown>;
  threeD?: boolean;
  onToggleThreeD?: () => void;
  onShowProcesses?: () => void;
}

const MEMORY_SEGMENTS = [
  { key: "app", labelKey: "overview.breakdown.app", color: "var(--dsw-alias-brand-primary)" },
  { key: "wired", labelKey: "overview.breakdown.wired", color: "var(--dsw-alias-state-warn-primary)" },
  { key: "compressed", labelKey: "overview.breakdown.compressed", color: "var(--dsw-alias-state-error-primary)" },
  { key: "cached", labelKey: "overview.breakdown.cached", color: "var(--dsw-alias-state-idle-primary)" },
  { key: "free", labelKey: "overview.breakdown.free", color: "var(--dsw-alias-border-l2)" },
];

interface Alert {
  key: string;
  icon: string;
  tone: string;
  text: string;
}

function buildAlerts(t: Translator, metrics: any): Alert[] {
  const alerts: Alert[] = [];
  if (!metrics) return alerts;
  const memory = metrics.memory;
  const memoryPercent = percentOf(memory.usedBytes, memory.totalBytes);
  if (memoryPercent !== null && memoryPercent > 85) {
    alerts.push({
      key: "memory-high",
      icon: "memory",
      tone: memoryPercent >= 94 ? "error" : "warn",
      text: t("overview.alert.memoryHigh", { percent: fmtPercent(memoryPercent) }),
    });
  }
  if (memory.pressure !== "normal") {
    alerts.push({
      key: "memory-pressure",
      icon: "memory",
      tone: memory.pressure === "critical" ? "error" : "warn",
      text: t("overview.alert.memoryPressure", { level: t(pressureKey(memory.pressure)) }),
    });
  }
  if (isFiniteNumber(memory.swapUsedBytes) && memory.swapUsedBytes > 1024 * 1024 * 1024) {
    alerts.push({ key: "swap", icon: "disk", tone: "warn", text: t("overview.alert.swap", { value: fmtBytes(memory.swapUsedBytes) }) });
  }
  const cpuPercent = metrics.cpu.usagePercent;
  if (cpuPercent !== null && cpuPercent > 90) {
    alerts.push({ key: "cpu-high", icon: "cpu", tone: "warn", text: t("overview.alert.cpuHigh", { percent: fmtPercent(cpuPercent) }) });
  }
  const diskPercent = percentOf(metrics.disk.usedBytes, metrics.disk.totalBytes);
  if (diskPercent !== null && diskPercent > 90) {
    alerts.push({
      key: "disk-high",
      icon: "disk",
      tone: diskPercent >= 97 ? "error" : "warn",
      text: t("overview.alert.diskHigh", { percent: fmtPercent(diskPercent) }),
    });
  }
  const battery = metrics.battery;
  if (battery && battery.present && battery.percent !== null && battery.percent <= 20 && !battery.charging) {
    alerts.push({ key: "battery-low", icon: "battery", tone: "error", text: t("overview.alert.batteryLow", { percent: fmtPercent(battery.percent) }) });
  }
  const thermal = asObject(metrics.thermal);
  const readings = [thermal.cpuCelsius, thermal.gpuCelsius].filter((value) => isFiniteNumber(value));
  const temperature = readings.length > 0 ? Math.max(...readings) : null;
  if (temperature !== null && temperature >= 90) {
    alerts.push({ key: "thermal", icon: "warning", tone: "error", text: t("overview.alert.thermal", { temp: Math.round(temperature) }) });
  }
  return alerts;
}

export function OverviewTab(props: OverviewTabProps) {
  const t = props.t;
  const metrics = props.metrics;
  const samples = asObject(props.samples);
  const sampleList = (key: string) => asArray(samples[key]);
  if (!metrics) return <Skeleton cards={5} />;
  const memory = metrics.memory;
  const disk = metrics.disk;
  const cpu = metrics.cpu;
  const network = metrics.network;
  const battery = metrics.battery;
  const memoryPercent = percentOf(memory.usedBytes, memory.totalBytes);
  const diskPercent = percentOf(disk.usedBytes, disk.totalBytes);
  const alerts = buildAlerts(t, metrics);
  const wifiLevel = network.wifi ? rssiLevel(network.wifi.rssi) : 0;
  const wifiQuality =
    network.wifi && network.wifi.rssi !== null ? clamp(((network.wifi.rssi + 100) / 70) * 100, 0, 100) : null;
  const batteryTone =
    battery && battery.percent !== null
      ? battery.percent <= 20
        ? "var(--dsw-alias-state-error-primary)"
        : battery.charging
          ? "var(--dsw-alias-state-success-primary)"
          : "var(--dsw-alias-brand-primary)"
      : "var(--dsw-alias-state-idle-primary)";
  const batterySub = !battery || battery.present === false
    ? t("overview.kpi.noBattery")
    : battery.charging
      ? t("overview.kpi.charging")
      : battery.plugged
        ? t("overview.kpi.plugged")
        : battery.timeRemainingMin !== null
          ? t("overview.kpi.remaining", { value: fmtUptime(battery.timeRemainingMin * 60, t) })
          : t("overview.kpi.onBattery");

  const heroChips: ReactNode[] = [
    <span className="dx-chip" key="cores">
      <Icon name="cpu" size={13} />
      <strong>{String(numOr(cpu.logicalCores, 0))}</strong>
      {t("hw.cores")}
    </span>,
    <span className="dx-chip" key="uptime">
      <Icon name="clock" size={13} />
      {t("sys.uptime")}
      <strong>{fmtUptime(metrics.uptimeSec, t)}</strong>
    </span>,
    <span
      className="dx-chip"
      data-tone={memory.pressure === "normal" ? "ok" : memory.pressure === "warning" ? "warn" : "error"}
      key="pressure"
    >
      <Icon name="memory" size={13} />
      {t("overview.kpi.pressure")}
      <strong>{t(pressureKey(memory.pressure))}</strong>
    </span>,
  ];
  const thermalNow = asObject(metrics.thermal);
  const temperatureC = [thermalNow.cpuCelsius, thermalNow.batteryCelsius, thermalNow.gpuCelsius].find((value: unknown) =>
    isFiniteNumber(value),
  );
  if (isFiniteNumber(temperatureC)) {
    heroChips.push(
      <span className="dx-chip" key="temperature">
        <Icon name="spark" size={13} />
        {t("overview.kpi.temp")}
        <strong>{fmtNumber(temperatureC, 1)} °C</strong>
      </span>,
    );
  }
  if (network.wifi) {
    heroChips.push(
      <span className="dx-chip" key="wifi">
        <Icon name="wifi" size={13} />
        <strong>{network.wifi.ssid || t("common.wifi")}</strong>
        <SignalBars level={wifiLevel} label={t("net.signalLevel", { level: wifiLevel })} />
      </span>,
    );
  } else if (network.defaultInterface) {
    heroChips.push(
      <span className="dx-chip" key="iface">
        <Icon name="network" size={13} />
        {network.defaultInterface}
        <strong>{asArray(network.primaryIpv4)[0] || ""}</strong>
      </span>,
    );
  }

  const memorySegments = MEMORY_SEGMENTS.map((segment) => {
    const value = numOr(memory[segment.key + "Bytes"], null);
    return { key: segment.key, label: t(segment.labelKey), color: segment.color, bytes: value, percent: percentOf(value, memory.totalBytes) };
  });
  const memorySegmentsKnown = memorySegments.filter((segment) => segment.percent !== null);
  const memoryKnownPercent = memorySegmentsKnown.reduce((total, segment) => total + (segment.percent as number), 0);
  const topProcesses = asArray(metrics.processes.top).slice(0, 8);

  return (
    <div className="dx-section">
      <section className="dx-heroCard">
        <DeviceScene
          active={props.threeD !== false}
          toggleLabel={props.threeD === false ? t("header.motionOn") : t("header.motionOff")}
          toggleAriaLabel={t("aria.motion")}
          onToggle={props.onToggleThreeD}
        />
        <div className="dx-heroInfo">
          <h1 className="dx-heroTitle" title={metrics.hostname}>
            {metrics.hostname || t("panel")}
          </h1>
          <p className="dx-heroSub">{metrics.osVersion || cpu.model || t("loading.title")}</p>
          <div className="dx-heroChips">{heroChips}</div>
        </div>
      </section>
      <Card title={t("overview.alerts")} icon="warning">
        {alerts.length === 0 ? (
          <div className="dx-alertList">
            <div className="dx-alert" data-tone="idle">
              <span className="dx-alertIcon">
                <Icon name="check" size={15} />
              </span>
              <span className="dx-alertText">{t("overview.alerts.none")}</span>
            </div>
          </div>
        ) : (
          <div className="dx-alertList" role="list" aria-label={t("aria.alert")}>
            {alerts.map((alert) => (
              <div className="dx-alert" data-tone={alert.tone} role="listitem" key={alert.key}>
                <span className="dx-alertIcon">
                  <Icon name={alert.icon} size={15} />
                </span>
                <span className="dx-alertText">{alert.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="dx-kpiGrid">
        <KpiCard
          label={t("overview.kpi.cpu")}
          value={fmtPercent(cpu.usagePercent)}
          sub={
            t("overview.kpi.cores", { n: numOr(cpu.logicalCores, 0) }) +
            " · " +
            t("overview.kpi.load") +
            " " +
            fmtNumber(asArray(cpu.loadAvg)[0], 1)
          }
          donut={<Donut value={cpu.usagePercent} color={usageTone(cpu.usagePercent)} label={t("overview.sparkline.cpu")} />}
          spark={<Sparkline series={[{ values: sampleList("cpu"), color: "var(--dsw-alias-brand-primary)" }]} domainMax={100} label={t("overview.sparkline.cpu")} />}
        />
        <KpiCard
          label={t("overview.kpi.memory")}
          value={fmtPercent(memoryPercent)}
          sub={
            t("overview.kpi.used", { value: fmtBytes(memory.usedBytes) }) +
            " / " +
            fmtBytes(memory.totalBytes) +
            (isFiniteNumber(memory.swapUsedBytes) && memory.swapUsedBytes > 0
              ? " · " + t("overview.kpi.swap", { value: fmtBytes(memory.swapUsedBytes) })
              : "")
          }
          donut={
            <Donut
              value={memoryPercent}
              color={memory.pressure === "normal" ? usageTone(memoryPercent) : pressureTone(memory.pressure)}
              label={t("overview.kpi.memory")}
            />
          }
          spark={<Sparkline series={[{ values: sampleList("memory"), color: "var(--dsw-alias-state-warn-primary)" }]} domainMax={100} label={t("overview.sparkline.memory")} />}
        />
        <KpiCard
          label={t("overview.kpi.disk")}
          value={fmtPercent(diskPercent)}
          sub={t("overview.kpi.free", { value: fmtBytes(disk.freeBytes) })}
          donut={<Donut value={diskPercent} color={usageTone(diskPercent)} label={t("overview.kpi.disk")} />}
          spark={<Sparkline series={[{ values: sampleList("disk"), color: "var(--dsw-alias-state-idle-primary)" }]} domainMax={100} label={t("overview.kpi.disk")} />}
        />
        <KpiCard
          label={t("overview.kpi.battery")}
          value={battery && battery.present ? fmtPercent(battery.percent) : t("common.na")}
          sub={batterySub}
          donut={
            <Donut
              value={battery && battery.present ? battery.percent : null}
              color={batteryTone}
              label={t("overview.kpi.battery")}
            />
          }
          spark={<Sparkline series={[{ values: sampleList("battery"), color: "var(--dsw-alias-state-success-primary)" }]} domainMax={100} label={t("overview.kpi.battery")} />}
        />
        <KpiCard
          label={t("overview.kpi.network")}
          value={network.wifi ? network.wifi.ssid || t("common.wifi") : network.defaultInterface || t("common.na")}
          sub={t("overview.kpi.rx", { value: fmtRate(network.rxBytesPerSec) }) + " · " + t("overview.kpi.tx", { value: fmtRate(network.txBytesPerSec) })}
          donut={
            <Donut
              value={wifiQuality}
              color={network.wifi ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-idle-primary)"}
              label={t("aria.wifiBars")}
              centerText={
                network.wifi ? (
                  <SignalBars level={wifiLevel} label={t("net.signalLevel", { level: wifiLevel })} />
                ) : (
                  <Icon name="network" size={17} />
                )
              }
            />
          }
          spark={
            <Sparkline
              series={[
                { values: sampleList("rx"), color: "var(--dsw-alias-state-success-primary)" },
                { values: sampleList("tx"), color: "var(--dsw-alias-brand-primary)" },
              ]}
              label={t("overview.sparkline.network")}
            />
          }
        />
      </div>
      <div className="dx-grid2">
        <Card
          title={t("overview.top")}
          icon="processes"
          actions={
            props.onShowProcesses ? (
              <button type="button" className="dx-linkBtn" onClick={props.onShowProcesses}>
                {t("tab.processes")}
                <Icon name="chevron" size={12} />
              </button>
            ) : null
          }
        >
          {topProcesses.length === 0 ? (
            <EmptyState title={t("overview.top.empty")} />
          ) : (
            <div className="dx-list">
              {topProcesses.map((process: any, index: number) => (
                <div className="dx-listRow" key={process.pid + "-" + index}>
                  <span className="dx-listRank">{String(index + 1)}</span>
                  <div className="dx-grow">
                    <div className="dx-listPrimary">{process.name}</div>
                    <div className="dx-listSecondary">
                      {(process.user || t("common.unknown")) + " · PID " + process.pid}
                    </div>
                  </div>
                  <div className="dx-listRight">
                    <span title={t("common.cpu")}>{fmtPercent(process.cpu, 1)}</span>
                    <span title={t("common.memory")}>{fmtPercent(process.memPercent, 1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={t("overview.memoryBreakdown")} icon="memory" subtitle={fmtBytes(memory.totalBytes)}>
          <div>
            <div className="dx-stackBar" role="img" aria-label={t("overview.memoryBreakdown")}>
              {memorySegmentsKnown.map((segment) => (
                <span
                  key={segment.key}
                  className="dx-stackSeg"
                  style={{ width: (memoryKnownPercent > 0 ? (segment.percent as number) : 0) + "%", background: segment.color }}
                />
              ))}
            </div>
            <div className="dx-legend">
              {memorySegments.map((segment) => (
                <div className="dx-legendRow" key={segment.key}>
                  <span className="dx-legendDot" style={{ background: segment.color }} />
                  <span className="dx-legendLabel">{segment.label}</span>
                  <span className="dx-legendValue">{segment.bytes === null ? "—" : fmtBytes(segment.bytes)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
