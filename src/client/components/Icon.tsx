/**
 * Inline SVG icon — reads the frozen icon path table from constants.js.
 * Classic JSX transform (`jsxFactory: h`); dynamic shapes are emitted with `h`.
 */
import type { ReactElement } from "react";
import { h } from "../jsx.js";
import { ICONS } from "../constants.js";
import { numOr, strOr } from "../helpers.js";

type IconShape = [string, Record<string, unknown>];

export interface IconProps {
  name?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon(props: IconProps): ReactElement {
  const name = strOr(props.name, "info");
  const size = numOr(props.size, 16);
  const table = ICONS as unknown as Record<string, IconShape[]>;
  const shapes = table[name] || table.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={numOr(props.strokeWidth, 1.7)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={props.className}
    >
      {shapes.map((shape, index) => h(shape[0], Object.assign({ key: index }, shape[1])))}
    </svg>
  );
}
