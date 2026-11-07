/** Grid of Fact cells with an empty-state fallback. */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { asArray } from "../helpers.js";
import { EmptyState } from "./EmptyState";
import { Fact } from "./Fact";

export type Translator = (key: string) => string;

export interface FactItem {
  key?: string | number;
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
  title?: string;
}

export interface FactGridProps {
  t?: Translator;
  items?: FactItem[];
  emptyText?: string;
}

export function FactGrid(props: FactGridProps) {
  const t = props.t || ((key: string) => key);
  const items = asArray(props.items).filter(Boolean) as FactItem[];
  if (items.length === 0) return <EmptyState title={props.emptyText || t("common.empty")} />;
  return (
    <div className="dx-factGrid">
      {items.map((item, index) => (
        <Fact key={item.key || index} label={item.label} value={item.value} wide={item.wide} title={item.title} />
      ))}
    </div>
  );
}
