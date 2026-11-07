/** Empty-state block with an optional icon and action. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { strOr } from "../helpers.js";
import { Icon } from "./Icon";

export interface EmptyStateProps {
  icon?: string;
  title?: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div className="dx-empty">
      <span className="dx-emptyIcon">
        <Icon name={strOr(props.icon, "info")} size={22} />
      </span>
      {props.title ? <p className="dx-emptyTitle">{props.title}</p> : null}
      {props.text ? <p className="dx-emptyText">{props.text}</p> : null}
      {props.action || null}
    </div>
  );
}
