/** One security status card (FileVault/SIP/Gatekeeper/firewall/BitLocker/…). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { asObject, boolOrNull, strOr } from "../helpers.js";
import { Icon } from "./Icon";
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
    <div className="dx-card">
      <div className="dx-cardHead" style={{ marginBottom: "7px" }}>
        <span className="dx-cardHeadIcon">
          <Icon name={props.icon} size={15} />
        </span>
        <div className="dx-cardTitles">
          <h2 className="dx-cardTitle">{props.title}</h2>
        </div>
        <div className="dx-cardActions">{securityEnabledPill(t, info)}</div>
      </div>
      {props.extra || null}
      {raw ? (
        <p className="dx-small dx-muted" style={{ marginTop: "7px" }} title={raw}>
          {raw}
        </p>
      ) : null}
    </div>
  );
}
