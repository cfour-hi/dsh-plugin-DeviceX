/** Section card with a title row, optional actions and a body. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { joinClass } from "../helpers.js";
import { Icon } from "./Icon";

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Compact status label rendered next to the title. */
  badge?: ReactNode;
  icon?: string;
  children?: ReactNode;
  span?: 1 | 2 | "full";
  flush?: boolean;
  className?: string;
}

export function Card(props: CardProps) {
  const head =
    props.title || props.subtitle || props.actions ? (
      <div className="dx-cardHead">
        {props.icon ? (
          <span className="dx-cardHeadIcon">
            <Icon name={props.icon} size={15} />
          </span>
        ) : null}
        <div className="dx-cardTitles">
          {props.title ? (
            <div className="dx-cardTitleRow">
              <h2 className="dx-cardTitle">{props.title}</h2>
              {props.badge ? <span className="dx-cardBadge">{props.badge}</span> : null}
            </div>
          ) : null}
          {props.subtitle ? <p className="dx-cardSub">{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="dx-cardActions">{props.actions}</div> : null}
      </div>
    ) : null;
  return (
    <section className={joinClass("dx-card", props.className)} data-span={props.span === 2 ? "2" : props.span === "full" ? "full" : undefined}>
      {head}
      <div className={props.flush ? "dx-cardBody dx-cardBodyFlush" : "dx-cardBody"}>{props.children}</div>
    </section>
  );
}
