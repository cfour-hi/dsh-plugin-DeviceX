/** One security status card (FileVault/SIP/Gatekeeper/firewall/BitLocker/…). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { asObject, boolOrNull, strOr } from "../helpers.js";
import { Card } from "./Card";
import { Pill } from "./Pill";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

function securityEnabledPill(t: Translator, info: any) {
  const enabled = boolOrNull(asObject(info).enabled);
  if (enabled === true) return <Pill tone="ok">{t("sec.on")}</Pill>;
  if (enabled === false) return <Pill tone="warn">{t("sec.off")}</Pill>;
  return <Pill tone="idle">{t("sec.unknown")}</Pill>;
}

export interface SecurityStatusCardProps {
  t: Translator;
  title?: ReactNode;
  icon?: string;
  info?: any;
  extra?: ReactNode;
}

export function SecurityStatusCard(props: SecurityStatusCardProps) {
  const t = props.t;
  const info = asObject(props.info);
  const raw = strOr(info.raw, "");
  return (
    <Card title={props.title} icon={props.icon} actions={securityEnabledPill(t, info)}>
      {props.extra || null}
      {raw ? (
        <p className="dx-small dx-muted" style={{ marginTop: props.extra ? "10px" : "0" }} title={raw}>
          {raw}
        </p>
      ) : null}
    </Card>
  );
}
