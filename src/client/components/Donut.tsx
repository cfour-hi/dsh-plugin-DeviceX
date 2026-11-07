/** SVG donut gauge used by the Overview KPIs. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { clamp, fmtPercent, isFiniteNumber, numOr, strOr } from "../helpers.js";

export interface DonutProps {
  value?: number | null;
  size?: number;
  stroke?: number;
  label?: string;
  color?: string;
  centerText?: ReactNode;
}

export function Donut(props: DonutProps) {
  const size = numOr(props.size, 62);
  const stroke = numOr(props.stroke, 7);
  const percent = isFiniteNumber(props.value) ? clamp(props.value, 0, 100) : null;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : (percent / 100) * circumference;
  return (
    <div
      className="dx-donutWrap"
      style={{ width: size, height: size }}
      role="img"
      aria-label={strOr(props.label, fmtPercent(percent))}
    >
      <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--dsw-alias-border-l1)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strOr(props.color, "var(--dsw-alias-brand-primary)")}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={filled.toFixed(2) + " " + circumference.toFixed(2)}
          transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
          style={{ transition: "stroke-dasharray .55s ease" }}
        />
      </svg>
      {props.centerText === undefined || props.centerText === null ? null : (
        <div className="dx-donutCenter">{props.centerText}</div>
      )}
    </div>
  );
}
