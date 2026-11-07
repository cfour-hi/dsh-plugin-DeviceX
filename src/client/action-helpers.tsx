/** Shared action-catalog helpers + the auto-generated action form field/card. */
import { Fragment, h } from "./jsx.js";
import { asArray, asObject, isFiniteNumber } from "./helpers.js";
import {
  ACTION_GROUPS,
  ACTION_META,
  DANGER_LABEL_KEYS,
  GROUP_LABEL_KEYS,
  OPTION_LABEL_KEYS,
  PARAM_LABEL_KEYS,
  PARAM_PLACEHOLDER_KEYS,
} from "./constants.js";
import { useId } from "./hooks.js";
import { Icon } from "./components/Icon";
import { Pill } from "./components/Pill";
import { Switch } from "./components/Switch";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface ActionParam {
  name: string;
  type: "number" | "string" | "boolean" | "select";
  required: boolean;
  options?: string[];
  min?: number | null;
  max?: number | null;
  placeholder?: string;
}

export interface ActionSpec {
  id: string;
  group: string;
  danger: string;
  requiresAdmin: boolean;
  params: ActionParam[];
}

export interface ActionMeta {
  group: string;
  danger: string;
  requiresAdmin: boolean;
  icon: string;
  labelKey: string | null;
  descKey: string | null;
}

export function actionMetaOf(action: ActionSpec): ActionMeta {
  const known = (ACTION_META as Record<string, any>)[action.id];
  if (known) {
    return {
      group: action.group,
      danger: action.danger,
      requiresAdmin: action.requiresAdmin,
      icon: known.icon,
      labelKey: known.labelKey,
      descKey: known.descKey,
    };
  }
  return {
    group: action.group,
    danger: action.danger,
    requiresAdmin: action.requiresAdmin,
    icon: "actions",
    labelKey: null,
    descKey: null,
  };
}

export function actionLabel(t: Translator, id: string) {
  const meta = (ACTION_META as Record<string, any>)[id];
  return meta ? t(meta.labelKey) : id;
}

export function paramLabel(t: Translator, param: ActionParam) {
  const key = (PARAM_LABEL_KEYS as Record<string, string>)[param.name];
  return key ? t(key) : param.name;
}

export function optionLabel(t: Translator, value: unknown) {
  const text = String(value);
  const key = (OPTION_LABEL_KEYS as Record<string, string>)[text];
  return key ? t(key) : text;
}

export function defaultParamValues(action: ActionSpec): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const param of asArray(action.params) as ActionParam[]) {
    if (param.type === "boolean") values[param.name] = false;
    else if (param.type === "select") {
      const options = asArray(param.options);
      values[param.name] = options.length > 0 ? String(options[0]) : "";
    }
    else values[param.name] = "";
  }
  return values;
}

export function validateActionParams(t: Translator, action: ActionSpec, values: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const source = asObject(values);
  for (const param of asArray(action.params) as ActionParam[]) {
    const raw = source[param.name];
    const label = paramLabel(t, param);
    if (param.type === "boolean") continue;
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (param.type === "number") {
      if (text.length === 0) {
        if (param.required) errors[param.name] = t("act.invalidRequired", { name: label });
        continue;
      }
      const numeric = Number(text);
      const min = param.min === null ? "—" : param.min;
      const max = param.max === null ? "—" : param.max;
      if (!isFiniteNumber(numeric) || (param.min !== null && param.min !== undefined && numeric < param.min) || (param.max !== null && param.max !== undefined && numeric > param.max)) {
        errors[param.name] = t("act.invalidNumber", { min, max });
      }
    } else if (param.type === "select") {
      if (text.length === 0 && param.required) errors[param.name] = t("act.invalidSelect", { name: label });
    } else if (text.length === 0 && param.required) {
      errors[param.name] = t("act.invalidRequired", { name: label });
    }
  }
  return errors;
}

export function paramDisplayValue(t: Translator, param: ActionParam, values: unknown) {
  const raw = asObject(values)[param.name];
  if (param.type === "boolean") return raw === true ? t("common.on") : t("common.off");
  if (raw === null || raw === undefined || String(raw).length === 0) return "—";
  if (param.type === "select") return optionLabel(t, raw);
  return String(raw);
}

export interface ParamFieldProps {
  t: Translator;
  param: ActionParam;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (next: unknown) => void;
}

export function ParamField(props: ParamFieldProps) {
  const t = props.t;
  const param = props.param;
  const value = props.value;
  const id = "dx-param-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const label = paramLabel(t, param);
  const placeholder = (PARAM_PLACEHOLDER_KEYS as Record<string, string>)[param.name]
    ? t((PARAM_PLACEHOLDER_KEYS as Record<string, string>)[param.name])
    : "";
  const error = props.error;
  if (param.type === "boolean") {
    return (
      <div className="dx-field">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <label className="dx-fieldLabel" htmlFor={id}>
            {label}
          </label>
          <Switch checked={value === true} label={label} onChange={() => props.onChange(value !== true)} disabled={props.disabled === true} />
        </div>
        {error ? <span className="dx-fieldError">{error}</span> : null}
      </div>
    );
  }
  let control;
  if (param.type === "select") {
    const options = asArray(param.options);
    control = (
      <select
        id={id}
        className="dx-select"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{t("act.selectPlaceholder")}</option>
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {optionLabel(t, option)}
          </option>
        ))}
      </select>
    );
  } else if (param.type === "number") {
    control = (
      <input
        id={id}
        type="number"
        className="dx-input"
        value={value === null || value === undefined ? "" : String(value)}
        min={param.min === null ? undefined : (param.min as number | undefined)}
        max={param.max === null ? undefined : (param.max as number | undefined)}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        className="dx-input"
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <div className="dx-field">
      <label className="dx-fieldLabel" htmlFor={id}>
        {label}
        {param.required ? (
          <span aria-hidden="true" style={{ marginLeft: "3px" }}>
            *
          </span>
        ) : null}
      </label>
      {control}
      {error ? (
        <span className="dx-fieldError" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface ActionCardProps {
  t: Translator;
  action: ActionSpec;
  meta: ActionMeta;
  values?: Record<string, unknown>;
  errors?: Record<string, string>;
  pending?: boolean;
  onChange: (name: string, next: unknown) => void;
  onRun: (action: ActionSpec, values: Record<string, unknown>) => void;
}

export function ActionCard(props: ActionCardProps) {
  const t = props.t;
  const action = props.action;
  const meta = props.meta;
  const values = asObject(props.values);
  const errors = asObject(props.errors);
  const pending = props.pending === true;
  const dangerKey = (DANGER_LABEL_KEYS as Record<string, string>)[meta.danger] || DANGER_LABEL_KEYS.low;
  return (
    <article className="dx-actionCard">
      <div className="dx-actionHead">
        <span className="dx-actionIcon">
          <Icon name={meta.icon} size={16} />
        </span>
        <div className="dx-actionTitles">
          <h3 className="dx-actionTitle">{meta.labelKey ? t(meta.labelKey) : action.id}</h3>
          {meta.descKey ? <p className="dx-actionDesc">{t(meta.descKey)}</p> : null}
          <div className="dx-actionBadges">
            <Pill tone={meta.danger === "high" ? "error" : meta.danger === "medium" ? "warn" : "idle"}>{t(dangerKey)}</Pill>
            {meta.requiresAdmin ? (
              <Pill tone="warn">
                <Icon name="lock" size={10} />
                {t("act.requiresAdmin")}
              </Pill>
            ) : null}
          </div>
        </div>
      </div>
      {asArray(action.params).length > 0 ? (
        <div className="dx-actionParams">
          {(asArray(action.params) as ActionParam[]).map((param) => (
            <ParamField
              key={param.name}
              t={t}
              param={param}
              value={values[param.name]}
              error={errors[param.name]}
              disabled={pending}
              onChange={(next) => props.onChange(param.name, next)}
            />
          ))}
        </div>
      ) : (
        <p className="dx-small dx-muted">{t("act.noParams")}</p>
      )}
      <div className="dx-actionFooter">
        <button
          type="button"
          className="dx-btn"
          data-variant={meta.danger === "high" ? "danger" : "primary"}
          disabled={pending}
          onClick={() => props.onRun(action, values)}
        >
          {pending ? (
            t("act.pending")
          ) : (
            <>
              <Icon name="actions" size={13} />
              {t("act.run")}
            </>
          )}
        </button>
      </div>
    </article>
  );
}
