/** Temperature/fan readings card (Host `metrics.thermal`, never faked). */
import { h } from "../jsx.js";
import { fmtNumber } from "../helpers.js";
import { normalizeThermal } from "../normalizers.js";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Pill } from "./Pill";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const THERMAL_PRESSURE_KEYS: Record<string, string> = {
  nominal: "hw.thermal.pressure.nominal",
  fair: "hw.thermal.pressure.fair",
  serious: "hw.thermal.pressure.serious",
  critical: "hw.thermal.pressure.critical",
};
const THERMAL_NOTE_KEYS: Record<string, string> = {
  "cpu-needs-admin": "hw.thermal.note.cpu-needs-admin",
  "wmi-unsupported": "hw.thermal.note.wmi-unsupported",
  unavailable: "hw.thermal.note.unavailable",
};

export interface ThermalCardProps {
  t: Translator;
  thermal?: any;
}

export function ThermalCard(props: ThermalCardProps) {
  const t = props.t;
  const thermal = normalizeThermal(props.thermal);
  const pressureLabel = thermal.pressure
    ? t(THERMAL_PRESSURE_KEYS[thermal.pressure] || THERMAL_PRESSURE_KEYS.nominal)
    : "";
  const facts = [
    thermal.cpuCelsius !== null ? { key: "cpu", label: t("hw.thermal.cpu"), value: fmtNumber(thermal.cpuCelsius, 1) + " °C" } : null,
    thermal.gpuCelsius !== null ? { key: "gpu", label: t("hw.thermal.gpu"), value: fmtNumber(thermal.gpuCelsius, 1) + " °C" } : null,
    thermal.batteryCelsius !== null
      ? { key: "battery", label: t("hw.thermal.battery"), value: fmtNumber(thermal.batteryCelsius, 1) + " °C" }
      : null,
    thermal.nvmeCelsius !== null ? { key: "nvme", label: t("hw.thermal.nvme"), value: fmtNumber(thermal.nvmeCelsius, 1) + " °C" } : null,
    pressureLabel
      ? {
          key: "pressure",
          label: t("hw.thermal.pressure"),
          value: (
            <Pill tone={thermal.pressure === "nominal" ? "ok" : thermal.pressure === "fair" ? "warn" : "error"}>{pressureLabel}</Pill>
          ),
        }
      : null,
    ...thermal.fans.map((fan: any, index: number) => ({
      key: "fan-" + index,
      label: fan.name ? t("hw.thermal.fan", { name: fan.name }) : t("hw.thermal.fans"),
      value: fan.rpm === null ? "—" : fmtNumber(fan.rpm) + " RPM",
    })),
  ].filter(Boolean);
  return (
    <Card title={t("hw.thermal.title")} icon="spark" subtitle={t("hw.thermal.subtitle")}>
      {facts.length > 0 ? (
        <FactGrid t={t} items={facts as any} emptyText={t("hw.thermal.none")} />
      ) : (
        <EmptyState icon="spark" title={t("hw.thermal.none")} />
      )}
      {thermal.note ? (
        <p className="dx-small dx-muted" style={{ marginTop: "10px" }}>
          {t(THERMAL_NOTE_KEYS[thermal.note] || THERMAL_NOTE_KEYS.unavailable)}
        </p>
      ) : null}
      {thermal.sources.length > 0 ? (
        <p className="dx-small dx-muted" style={{ marginTop: "8px" }}>
          {t("hw.thermal.sources") + ": " + thermal.sources.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
