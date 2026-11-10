/**
 * Hover/focus tooltip for compact status badges. CSS-only bubble (no portal, no
 * extra request): the text lives in `data-tip`, shown on hover and keyboard
 * focus, and is mirrored to assistive tech through `aria-label`.
 */
import type { ReactNode } from "react";
import { h } from "../jsx.js";

export interface TooltipProps {
  label: string;
  children?: ReactNode;
}

export function Tooltip(props: TooltipProps) {
  return (
    <span className="dx-tip" data-tip={props.label} tabIndex={0} role="note" aria-label={props.label}>
      {props.children}
    </span>
  );
}
