/** Non-fatal section errors banner (Host `errors[]`). */
import type { ReactNode } from "react";
import { h } from "../jsx.js";
import { errorsOf } from "../helpers.js";
import { Icon } from "./Icon";

export type Translator = (key: string) => string;

export interface SectionErrorsProps {
  t: Translator;
  section?: any;
  labelKey?: string;
}

export function SectionErrors(props: SectionErrorsProps) {
  const errors = errorsOf(props.section);
  if (errors.length === 0) return null;
  return (
    <div className="dx-banner" data-tone="warn" role="status">
      <span className="dx-bannerIcon">
        <Icon name="info" size={14} />
      </span>
      <span className="dx-bannerText">{props.labelKey ? props.t(props.labelKey) : props.t("error.sectionHint")}</span>
      <span className="dx-small dx-muted" title={errors.join("\n")}>
        {errors[0]}
      </span>
    </div>
  );
}
