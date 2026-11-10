/** USB + Bluetooth device inventory in one table card: a view switch in the
 * header keeps the two long lists from stretching each other's row. */
import { Fragment, h } from "../jsx.js";
import { useState } from "../hooks.js";
import { asArray, asObject, fmtPercent, isObj, strOr } from "../helpers.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { FactGrid } from "./FactGrid";
import { Pill } from "./Pill";
import { SegmentedControl } from "./SegmentedControl";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ConnectionsCardProps {
  t: Translator;
  usbDevices?: any[];
  bluetooth?: any;
}

export function ConnectionsCard(props: ConnectionsCardProps) {
  const t = props.t;
  const [view, setView] = useState("usb");
  const usbDevices = asArray(props.usbDevices).filter(isObj);
  const bluetooth = asObject(props.bluetooth);
  const controller = asObject(bluetooth.controller);
  const btDevices = asArray(bluetooth.devices).filter(isObj);
  const controllerFacts = [
    controller.address ? { key: "address", label: t("common.address"), value: controller.address } : null,
    controller.chipset ? { key: "chipset", label: t("hw.chipset"), value: controller.chipset } : null,
    controller.firmware ? { key: "firmware", label: t("hw.firmware"), value: controller.firmware } : null,
    controller.state ? { key: "state", label: t("common.state"), value: controller.state } : null,
  ].filter(Boolean) as any[];
  const viewOptions = [
    { value: "usb", label: t("hw.usb") },
    { value: "bluetooth", label: t("hw.bluetooth") },
  ];
  return (
    <Card
      title={t("hw.connections")}
      icon={view === "usb" ? "usb" : "bluetooth"}
      actions={<SegmentedControl label={t("hw.connections.view")} options={viewOptions} value={view} onChange={setView} />}
      span="full"
    >
      {view === "usb" ? (
        usbDevices.length === 0 ? (
          <EmptyState title={t("hw.empty")} />
        ) : (
          <DataTable
            t={t}
            columns={[
              { key: "name", label: t("common.name"), render: (row: any) => strOr(row.name, "—") },
              { key: "vendor", label: t("hw.vendor"), render: (row: any) => strOr(row.vendor, "—") },
              { key: "serial", label: t("common.serial"), render: (row: any) => strOr(row.serial, "—") },
              {
                key: "speed",
                label: t("hw.usbSpeed"),
                render: (row: any) => (row.speed === null || row.speed === undefined ? "—" : String(row.speed)),
              },
              {
                key: "bus",
                label: t("hw.bus"),
                render: (row: any) => (row.bus === null || row.bus === undefined ? "—" : String(row.bus)),
              },
            ]}
            rows={usbDevices}
          />
        )
      ) : (
        <>
          {controllerFacts.length > 0 ? <FactGrid t={t} items={controllerFacts} emptyText={t("common.empty")} /> : null}
          {btDevices.length > 0 ? (
            <div style={{ marginTop: controllerFacts.length > 0 ? "12px" : "0" }}>
              <DataTable
                t={t}
                columns={[
                  { key: "name", label: t("common.name"), render: (row: any) => strOr(row.name, "—") },
                  { key: "address", label: t("common.address"), render: (row: any) => strOr(row.address, "—") },
                  {
                    key: "connected",
                    label: t("common.status"),
                    render: (row: any) =>
                      row.connected === true ? <Pill tone="ok">{t("hw.connected")}</Pill> : <Pill tone="idle">{t("hw.notConnected")}</Pill>,
                  },
                  {
                    key: "battery",
                    label: t("common.battery"),
                    render: (row: any) =>
                      row.batteryPercent === null || row.batteryPercent === undefined ? "—" : fmtPercent(row.batteryPercent),
                  },
                ]}
                rows={btDevices}
              />
            </div>
          ) : (
            <p className="dx-small dx-muted" style={{ marginTop: controllerFacts.length > 0 ? "12px" : "0" }}>
              {t("hw.empty")}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
