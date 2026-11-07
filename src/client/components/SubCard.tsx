/** Compact sub-card row (GPU/display/audio/USB items). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { Icon } from "./Icon";

export interface SubCardProps {
  icon?: string;
  title?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
}

export function SubCard(props: SubCardProps) {
  return (
    <div className="dx-subcard">
      <div className="dx-subcardHead">
        {props.icon ? (
          <span className="dx-muted">
            <Icon name={props.icon} size={14} />
          </span>
        ) : null}
        <span className="dx-subcardTitle">{props.title}</span>
        {props.badge || null}
      </div>
      {props.meta ? <div className="dx-subcardMeta">{props.meta}</div> : null}
    </div>
  );
}
