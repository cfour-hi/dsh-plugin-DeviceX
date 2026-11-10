/** SVG sparkline (area + line) for the Overview samples. */
import type { ReactElement } from "react";
import { h } from "../jsx.js";
import { asArray, clamp, isFiniteNumber, isObj, numOr, strOr } from "../helpers.js";

export interface SparkSeries {
  values: Array<number | null>;
  color?: string;
}

export interface SparklineProps {
  series?: SparkSeries[];
  height?: number;
  domainMax?: number;
  label?: string;
}

export function Sparkline(props: SparklineProps) {
  const height = numOr(props.height, 26);
  const series = asArray(props.series).filter(
    (entry): entry is SparkSeries => isObj(entry) && asArray((entry as SparkSeries).values).length >= 2,
  );
  if (series.length === 0) return <div className="dx-spark dx-sparkEmpty" aria-hidden="true" />;
  let max = numOr(props.domainMax, 0);
  if (!(max > 0)) {
    for (const entry of series) {
      for (const value of entry.values) {
        if (isFiniteNumber(value) && value > max) max = value;
      }
    }
  }
  if (!(max > 0)) max = 1;
  const innerHeight = Math.max(4, height - 4);
  const parts: ReactElement[] = [];
  series.forEach((entry, seriesIndex) => {
    const values = asArray(entry.values).filter(isFiniteNumber);
    if (values.length < 2) return;
    const step = 100 / (values.length - 1);
    const points = values.map((value, index) => {
      const x = index * step;
      const y = height - 2 - (clamp(value, 0, max) / max) * innerHeight;
      return x.toFixed(2) + "," + y.toFixed(2);
    });
    const color = strOr(entry.color, "var(--dsw-alias-brand-primary)");
    if (seriesIndex === 0) {
      parts.push(
        <path
          key={"area-" + seriesIndex}
          d={"M0," + height + " L" + points.join(" L") + " L100," + height + " Z"}
          fill={color}
          opacity={0.1}
          stroke="none"
        />,
      );
    }
    parts.push(
      <polyline
        key={"line-" + seriesIndex}
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />,
    );
  });
  if (parts.length === 0) return <div className="dx-spark dx-sparkEmpty" aria-hidden="true" />;
  // Shared 0% baseline: the same frame under every KPI card, so a full ring,
  // a flat 100% area and a low CPU line all read against one reference.
  parts.push(
    <line
      key="baseline"
      className="dx-sparkBase"
      x1={0}
      y1={height - 1}
      x2={100}
      y2={height - 1}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    />,
  );
  return (
    <svg className="dx-spark" viewBox={"0 0 100 " + height} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {parts}
    </svg>
  );
}
