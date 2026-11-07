/** Accessible on/off switch (used by launch agents and the action forms). */
import { h } from "../jsx.js";

export interface SwitchProps {
  checked?: boolean;
  label?: string;
  disabled?: boolean;
  onChange?: () => void;
}

export function Switch(props: SwitchProps) {
  return (
    <button
      type="button"
      className="dx-switch"
      role="switch"
      aria-checked={props.checked === true}
      aria-label={props.label}
      disabled={props.disabled === true}
      onClick={props.onChange}
    >
      <span className="dx-switchThumb" aria-hidden="true" />
    </button>
  );
}
