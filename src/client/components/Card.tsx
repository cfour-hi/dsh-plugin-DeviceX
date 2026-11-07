/** Section card with a title row, optional actions and a body. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { joinClass } from "../helpers.js";
import { Icon } from "./Icon";

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: string;
  children?: ReactNode;
  span?: 1 | 2;
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
          {props.title ? <h2 className="dx-cardTitle">{props.title}</h2> : null}
          {props.subtitle ? <p className="dx-cardSub">{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="dx-cardActions">{props.actions}</div> : null}
      </div>
    ) : null;
  return (
    <section className={joinClass("dx-card", props.className)} data-span={props.span === 2 ? "2" : undefined}>
      {head}
      <div className={props.flush ? "dx-cardBody dx-cardBodyFlush" : "dx-cardBody"}>{props.children}</div>
    </section>
  );
}
