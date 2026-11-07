/** Overview KPI card: donut/value/sub + sparkline. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";

export interface KpiCardProps {
  label?: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  subTitle?: string;
  donut?: ReactNode;
  spark?: ReactNode;
}

export function KpiCard(props: KpiCardProps) {
  return (
    <div className="dx-kpi">
      <div className="dx-kpiTop">
        {props.donut}
        <div className="dx-kpiMeta">
          <div className="dx-kpiLabel">{props.label}</div>
          <div className="dx-kpiValue">{props.value}</div>
          {props.sub ? (
            <div className="dx-kpiSub" title={props.subTitle || undefined}>
              {props.sub}
            </div>
          ) : null}
        </div>
      </div>
      <div className="dx-kpiSpark">{props.spark}</div>
    </div>
  );
}
