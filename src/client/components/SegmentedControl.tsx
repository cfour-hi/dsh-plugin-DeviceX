/** Segmented button group (filters in Software/Processes). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { asArray } from "../helpers.js";

export interface SegmentOption {
  value: string;
  label: ReactNode;
}

export interface SegmentedControlProps {
  options?: SegmentOption[];
  value?: string;
  label?: string;
  onChange: (value: string) => void;
}

export function SegmentedControl(props: SegmentedControlProps) {
  const options = asArray(props.options) as SegmentOption[];
  return (
    <div className="dx-segmented" role="group" aria-label={props.label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="dx-segBtn"
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
