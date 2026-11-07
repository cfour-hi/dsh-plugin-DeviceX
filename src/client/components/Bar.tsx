/** Horizontal usage bar (per-core CPU and memory breakdowns). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { clamp, fmtPercent, isFiniteNumber, strOr, usageTone } from "../helpers.js";

export interface BarProps {
  label?: ReactNode;
  percent?: number | null;
  color?: string;
}

export function Bar(props: BarProps) {
  const percent = isFiniteNumber(props.percent) ? clamp(props.percent, 0, 100) : 0;
  return (
    <div className="dx-barRow">
      <div className="dx-barHead">
        <span className="dx-truncate">{props.label}</span>
        <span>{isFiniteNumber(props.percent) ? fmtPercent(percent) : "—"}</span>
      </div>
      <div className="dx-barTrack" role="presentation">
        <div className="dx-barFill" style={{ width: percent + "%", background: strOr(props.color, usageTone(percent)) }} />
      </div>
    </div>
  );
}
