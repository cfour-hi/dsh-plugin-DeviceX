/** One label/value cell of a FactGrid. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";

export interface FactProps {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
  title?: string;
}

export function Fact(props: FactProps) {
  return (
    <div className="dx-fact" data-wide={props.wide ? "true" : undefined}>
      <div className="dx-factLabel">{props.label}</div>
      <div className="dx-factValue" title={typeof props.title === "string" ? props.title : undefined}>
        {props.value}
      </div>
    </div>
  );
}
