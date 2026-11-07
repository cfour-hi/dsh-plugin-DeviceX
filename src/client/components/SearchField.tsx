/** Search input with a leading icon. */
import { h } from "../jsx.js";
import { strOr } from "../helpers.js";
import { Icon } from "./Icon";

export interface SearchFieldProps {
  value?: string;
  placeholder?: string;
  label?: string;
  onChange: (value: string) => void;
}

export function SearchField(props: SearchFieldProps) {
  return (
    <div className="dx-searchWrap">
      <span className="dx-searchIcon">
        <Icon name="search" size={14} />
      </span>
      <input
        type="search"
        className="dx-input"
        value={strOr(props.value, "")}
        placeholder={props.placeholder}
        aria-label={props.label || props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}
