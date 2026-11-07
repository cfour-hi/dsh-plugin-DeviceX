/**
 * Wi-Fi/signal strength bars — second `.tsx` component of the P2-b pilot.
 * Same classic-JSX transform as `Pill.tsx`: no react/jsx-runtime import.
 */
import { h } from "../jsx.js";

export interface SignalBarsProps {
  level?: number;
  label?: string;
}

export function SignalBars(props: SignalBarsProps) {
  const raw = Number(props.level);
  const level = Number.isFinite(raw) ? Math.min(4, Math.max(0, raw)) : 0;
  return (
    <span className="dx-signalWrap" role="img" aria-label={props.label || "Signal " + level + "/4"}>
      {[1, 2, 3, 4].map((index) => (
        <span key={index} className="dx-signalBar" data-on={index <= level ? "true" : "false"} />
      ))}
    </span>
  );
}
