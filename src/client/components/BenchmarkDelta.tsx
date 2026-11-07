/** "vs previous run" delta label for one benchmark result. */
import { h } from "../jsx.js";
import { isFiniteNumber } from "../helpers.js";
import { Icon } from "./Icon";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface BenchmarkDeltaProps {
  t: Translator;
  previous?: { score?: number | null } | null;
  score?: number | null;
}

export function BenchmarkDelta(props: BenchmarkDeltaProps) {
  const t = props.t;
  const previous = props.previous;
  if (!previous || typeof previous.score !== "number" || typeof props.score !== "number" || previous.score === 0) return null;
  const percent = ((props.score - previous.score) / previous.score) * 100;
  if (!isFiniteNumber(percent)) return null;
  const abs = Math.abs(percent);
  const tone = abs < 1 ? "flat" : percent > 0 ? "up" : "down";
  const label = tone === "flat" ? t("bench.flat") : t(tone === "up" ? "bench.better" : "bench.worse", { value: abs.toFixed(1) + "%" });
  return (
    <span className="dx-benchDelta" data-tone={tone}>
      {tone === "flat" ? null : <Icon name={tone === "up" ? "arrowUp" : "arrowDown"} size={12} />}
      {label}
    </span>
  );
}
