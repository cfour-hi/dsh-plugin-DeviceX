/**
 * Small status pill — first `.tsx` component of the P2-b pilot.
 *
 * It uses the classic JSX transform (`jsxFactory: "h"`): JSX compiles to the
 * `h` wrapper from `../jsx.js`, so the bundle still takes React only from the
 * module loader and never imports `react/jsx-runtime`.
 */
import type { ReactNode } from "react";
import { h } from "../jsx.js";

export interface PillProps {
  tone?: string;
  title?: string;
  children?: ReactNode;
}

export function Pill(props: PillProps) {
  return (
    <span className="dx-pill" data-tone={props.tone || "idle"} title={props.title}>
      {props.children}
    </span>
  );
}
