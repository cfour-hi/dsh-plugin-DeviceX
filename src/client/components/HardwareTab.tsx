/** Hardware tab: CPU/memory/GPU/displays/storage/battery/thermal/drivers/USB/BT/audio/cameras. */
import { Fragment, h } from "../jsx.js";
import {
  asArray,
  asObject,
  fmtBytes,
  fmtNumber,
  fmtPercent,
  isFiniteNumber,
  isObj,
  percentOf,
  strOr,
  usageTone,
} from "../helpers.js";
import { Bar } from "./Bar";
import { ConnectionsCard } from "./ConnectionsCard";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { DriversCard } from "./DriversCard";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { GraphicsCard } from "./GraphicsCard";
import { Pill } from "./Pill";
import { SubCard } from "./SubCard";
import { TabShell } from "./TabShell";
import type { TabState } from "./TabShell";
import { ThermalCard } from "./ThermalCard";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface HardwareTabProps {
  t: Translator;
  state?: TabState;
  metrics?: any;
  onRetry?: () => void;
}

export function HardwareTab(props: HardwareTabProps) {
  const t = props.t;
  const metrics = props.metrics;
  const perCore = metrics ? asArray(metrics.cpu.perCore) : [];
  return (
    <TabShell t={t} state={props.state} skeletonCards={4} onRetry={props.onRetry} errorsKey="hw.errors">
      {(data: any) => {
        const cpu = asObject(data.cpu);
        const memory = asObject(data.memory);
        const storage = asObject(data.storage);
        const battery = isObj(data.battery) ? data.battery : null;
        const features = asArray(cpu.features).filter((feature) => typeof feature === "string");
        const modules = asArray(memory.modules).filter(isObj);
        const gpus = asArray(data.gpu).filter(isObj);
        const displays = asArray(data.displays).filter(isObj);
        const drives = asArray(storage.physical).filter(isObj);
        const volumes = asArray(storage.volumes).filter(isObj);
        const usbDevices = asArray(data.usb).filter(isObj);
        const audioDevices = asArray(data.audio).filter(isObj);
        const cameras = asArray(data.cameras).filter(isObj);
        const drivers = asArray(data.drivers).filter(isObj);
        const driverSummary = asObject(data.driverSummary);
        const driverProblems = asArray(data.driverProblems).filter(isObj);
        return (
          <div className="dx-section">
            <div className="dx-grid dx-gridDense">
              <Card title={t("hw.cpu")} icon="cpu" subtitle={strOr(cpu.model, "")} span={2}>
                <FactGrid
                  t={t}
                  items={[
                    cpu.model ? { key: "model", label: t("common.model"), value: cpu.model } : null,
                    cpu.vendor ? { key: "vendor", label: t("hw.vendor"), value: cpu.vendor } : null,
                    cpu.architecture ? { key: "arch", label: t("hw.arch"), value: cpu.architecture } : null,
                    cpu.physicalCores !== null && cpu.physicalCores !== undefined
                      ? { key: "physical", label: t("hw.physical"), value: String(cpu.physicalCores) }
                      : null,
                    cpu.logicalCores !== null && cpu.logicalCores !== undefined
                      ? { key: "logical", label: t("hw.logical"), value: String(cpu.logicalCores) }
                      : null,
                    isFiniteNumber(cpu.speedGHz) ? { key: "speed", label: t("hw.speed"), value: fmtNumber(cpu.speedGHz, 2) + " GHz" } : null,
                  ].filter(Boolean) as any}
                  emptyText={t("hw.errors")}
                />
                {features.length > 0 ? (
                  <div className="dx-tagList" style={{ marginTop: "12px" }}>
                    {features.slice(0, 12).map((feature: string) => (
                      <Pill key={feature} tone="idle">
                        {feature}
                      </Pill>
                    ))}
                  </div>
                ) : null}
                {perCore.length > 0 ? (
                  <div style={{ marginTop: "14px" }}>
                    <div className="dx-factLabel" style={{ marginBottom: "7px" }}>
                      {t("hw.cpuCore")}
                    </div>
                    <div className="dx-bars">
                      {perCore.map((value: any, index: number) => (
                        <Bar key={index} label={"#" + (index + 1)} percent={value} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
              <Card
                title={t("hw.memory")}
                icon="memory"
                subtitle={memory.totalBytes !== null ? fmtBytes(memory.totalBytes) : ""}
              >
                <FactGrid
                  t={t}
                  items={[
                    memory.type ? { key: "type", label: t("common.type"), value: memory.type } : null,
                    isFiniteNumber(memory.speedMHz) ? { key: "speed", label: t("hw.speed"), value: fmtNumber(memory.speedMHz) + " MHz" } : null,
                  ].filter(Boolean) as any}
                  emptyText={t("common.empty")}
                />
                {modules.length > 0 ? (
                  <>
                    <div className="dx-factLabel" style={{ margin: "12px 0 6px" }}>
                      {t("hw.memoryModules")}
                    </div>
                    <DataTable
                      t={t}
                      columns={[
                        { key: "slot", label: t("hw.slot"), render: (row: any) => strOr(row.slot, "—") },
                        { key: "size", label: t("common.size"), render: (row: any) => fmtBytes(row.sizeBytes) },
                        { key: "type", label: t("common.type"), render: (row: any) => strOr(row.type, "—") },
                        {
                          key: "speed",
                          label: t("hw.speed"),
                          render: (row: any) => (isFiniteNumber(row.speedMHz) ? fmtNumber(row.speedMHz) + " MHz" : "—"),
                        },
                        { key: "manufacturer", label: t("hw.manufacturer"), render: (row: any) => strOr(row.manufacturer, "—") },
                        { key: "part", label: t("hw.partNumber"), render: (row: any) => strOr(row.partNumber, "—") },
                      ]}
                      rows={modules}
                    />
                  </>
                ) : (
                  <p className="dx-small dx-muted" style={{ marginTop: "10px" }}>
                    {t("hw.noModules")}
                  </p>
                )}
              </Card>
              <GraphicsCard t={t} gpus={gpus} displays={displays} />
              <Card title={t("hw.battery")} icon="battery">
                {battery ? (
                  <div className="dx-factGridForce2">
                    <FactGrid
                      t={t}
                      items={[
                        battery.condition ? { key: "condition", label: t("hw.condition"), value: battery.condition } : null,
                        battery.percent !== null && battery.percent !== undefined
                          ? { key: "percent", label: t("common.battery"), value: t("hw.batteryPercent", { percent: fmtPercent(battery.percent) }) }
                          : null,
                        battery.healthPercent !== null && battery.healthPercent !== undefined
                          ? { key: "health", label: t("hw.health"), value: fmtPercent(battery.healthPercent) }
                          : null,
                        battery.cycleCount !== null && battery.cycleCount !== undefined
                          ? { key: "cycles", label: t("hw.cycles"), value: String(battery.cycleCount) }
                          : null,
                        battery.designCapacityMah !== null && battery.designCapacityMah !== undefined
                          ? { key: "design", label: t("hw.designCapacity"), value: String(battery.designCapacityMah) + " mAh" }
                          : null,
                        battery.maxCapacityMah !== null && battery.maxCapacityMah !== undefined
                          ? { key: "max", label: t("hw.maxCapacity"), value: String(battery.maxCapacityMah) + " mAh" }
                          : null,
                        battery.temperatureC !== null && battery.temperatureC !== undefined
                          ? { key: "temperature", label: t("common.temperature"), value: fmtNumber(battery.temperatureC, 1) + " °C" }
                          : null,
                      ].filter(Boolean) as any}
                      emptyText={t("hw.batteryNoData")}
                    />
                  </div>
                ) : (
                  <EmptyState icon="battery" title={t("hw.batteryNoData")} />
                )}
              </Card>
              <Card title={t("hw.storage")} icon="disk" span="full">
                {drives.length > 0 ? (
                  <>
                    <div className="dx-factLabel" style={{ marginBottom: "6px" }}>
                      {t("hw.drives")}
                    </div>
                    <DataTable
                      t={t}
                      columns={[
                        { key: "name", label: t("common.name"), render: (row: any) => strOr(row.name, strOr(row.model, "—")) },
                        { key: "model", label: t("common.model"), render: (row: any) => strOr(row.model, "—") },
                        { key: "size", label: t("common.size"), render: (row: any) => fmtBytes(row.sizeBytes) },
                        { key: "media", label: t("hw.mediaType"), render: (row: any) => strOr(row.mediaType, "—") },
                        { key: "smart", label: t("hw.smart"), render: (row: any) => strOr(row.smartStatus, "—") },
                      ]}
                      rows={drives}
                    />
                  </>
                ) : null}
                {volumes.length > 0 ? (
                  <div style={{ marginTop: drives.length > 0 ? "16px" : "0" }}>
                    <div className="dx-factLabel" style={{ marginBottom: "8px" }}>
                      {t("hw.volumes")}
                    </div>
                    <div className="dx-sublist">
                      {volumes.map((volume: any, index: number) => {
                        const percent = percentOf(volume.usedBytes, volume.totalBytes);
                        return (
                          <div key={index} className="dx-subcard">
                            <div className="dx-subcardHead">
                              <span className="dx-subcardTitle">{strOr(volume.name, strOr(volume.mount, "—"))}</span>
                              {volume.internal === false ? <Pill tone="idle">{t("hw.removable")}</Pill> : null}
                            </div>
                            <div className="dx-subcardMeta">
                              {strOr(volume.mount, "—") +
                                " · " +
                                strOr(volume.fs, "—") +
                                " · " +
                                fmtBytes(volume.usedBytes) +
                                " / " +
                                fmtBytes(volume.totalBytes)}
                            </div>
                            <div className="dx-barTrack" style={{ marginTop: "8px" }} role="presentation">
                              <div
                                className="dx-barFill"
                                style={{ width: (percent === null ? 0 : percent) + "%", background: usageTone(percent) }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <EmptyState title={t("common.empty")} />
                )}
              </Card>
              <DriversCard t={t} drivers={drivers} summary={driverSummary} problems={driverProblems} />
              <ConnectionsCard t={t} usbDevices={usbDevices} bluetooth={data.bluetooth} />
              <ThermalCard t={t} thermal={metrics ? metrics.thermal : null} />
              <Card title={t("hw.audio")} icon="audio">
                {audioDevices.length === 0 ? (
                  <EmptyState title={t("hw.empty")} />
                ) : (
                  <div className="dx-sublist">
                    {audioDevices.map((device: any, index: number) => (
                      <SubCard
                        key={index}
                        title={strOr(device.name, "—")}
                        icon="audio"
                        badge={
                          device.default === true ? (
                            <Pill tone="brand">{t("hw.default")}</Pill>
                          ) : device.kind === "input" ? (
                            <Pill tone="idle">{t("hw.input")}</Pill>
                          ) : (
                            <Pill tone="idle">{t("hw.output")}</Pill>
                          )
                        }
                        meta={strOr(device.manufacturer, "")}
                      />
                    ))}
                  </div>
                )}
              </Card>
              <Card title={t("hw.cameras")} icon="camera">
                {cameras.length === 0 ? (
                  <EmptyState title={t("hw.empty")} />
                ) : (
                  <DataTable
                    t={t}
                    columns={[
                      { key: "name", label: t("common.name"), render: (row: any) => strOr(row.name, "—") },
                      { key: "modelId", label: t("hw.modelId"), render: (row: any) => strOr(row.modelId, "—") },
                      { key: "uniqueId", label: t("hw.uniqueId"), render: (row: any) => strOr(row.uniqueId, "—") },
                    ]}
                    rows={cameras}
                  />
                )}
              </Card>
            </div>
          </div>
        );
      }}
    </TabShell>
  );
}
