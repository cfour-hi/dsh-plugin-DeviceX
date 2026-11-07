/** Section heading with an optional inline subtitle. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";

export interface SectionHeadProps {
  title?: ReactNode;
  subtitle?: ReactNode;
}

export function SectionHead(props: SectionHeadProps) {
  return (
    <div className="dx-sectionHead">
      <h2 className="dx-sectionTitle">{props.title}</h2>
      {props.subtitle ? <span className="dx-sectionSub">{props.subtitle}</span> : null}
    </div>
  );
}
