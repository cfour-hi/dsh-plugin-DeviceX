/**
 * Device X — the browser half of the plugin, bundled into `plugin/client.js`
 * by scripts/build-client.mjs from src/client/. Do not edit the generated file.
 *
 * Only `react` is required (a module-loader platform seed); every visible
 * string goes through the `devicex` locale dictionaries and all Host payloads
 * are treated as untrusted.
 */
import { getReact } from "./runtime.js";
import { Pill } from "./components/Pill";
import { SignalBars } from "./components/SignalBars";
import { Icon } from "./components/Icon";
import { Card } from "./components/Card";
import { Skeleton } from "./components/Skeleton";
import { EmptyState } from "./components/EmptyState";
import { Fact } from "./components/Fact";
import { FactGrid } from "./components/FactGrid";
import { DataTable } from "./components/DataTable";
import { Switch } from "./components/Switch";
import { Donut } from "./components/Donut";
import { Sparkline } from "./components/Sparkline";
import { Bar } from "./components/Bar";
import { SectionHead } from "./components/SectionHead";
import { SubCard } from "./components/SubCard";
import { SearchField } from "./components/SearchField";
import { SegmentedControl } from "./components/SegmentedControl";
import { ErrorState } from "./components/ErrorState";
import { KpiCard } from "./components/KpiCard";
import { OverviewTab } from "./components/OverviewTab";
import { TabShell } from "./components/TabShell";
import { HardwareTab } from "./components/HardwareTab";
import { SystemTab } from "./components/SystemTab";
import { SoftwareTab } from "./components/SoftwareTab";
import { NetworkTab } from "./components/NetworkTab";
import { SecurityTab } from "./components/SecurityTab";
import { ProcessesTab } from "./components/ProcessesTab";
import { CleanupTab } from "./components/CleanupTab";
import { BenchmarkTab } from "./components/BenchmarkTab";
import { spanIcon } from "./components/spanIcon";
import { SectionErrors } from "./components/SectionErrors";
import { DeviceScene } from "./components/DeviceScene";
import {
	NS,
	PANEL_ID,
	POLL_MS,
	MAX_SAMPLES,
	TAB_IDS,
	TAB_LABEL_KEYS,
	TAB_ICONS,
	SECTION_TABS,
	ACTION_GROUPS,
	GROUP_LABEL_KEYS,
	GROUP_ICONS,
	PARAM_LABEL_KEYS,
	PARAM_PLACEHOLDER_KEYS,
	OPTION_LABEL_KEYS,
	SIGNALS,
	DANGER_LABEL_KEYS,
	ACTION_META,
	ICONS,
} from "./constants.js";
import {
	isObj,
	asObject,
	asArray,
	isFiniteNumber,
	numOr,
	numOrNull,
	strOr,
	boolOrNull,
	clamp,
	joinClass,
	interpolate,
	makeTranslator,
	FALLBACK_T,
	BYTE_UNITS,
	fmtBytes,
	fmtRate,
	fmtPercent,
	fmtNumber,
	fmtUptime,
	fmtMs,
	fmtTime,
	fmtDateTime,
	percentOf,
	usageTone,
	pressureTone,
	pressureKey,
	rssiLevel,
	isIpv4,
	parseServerList,
	errorsOf,
	safeErrorText,
	pushSample,
} from "./helpers.js";
import { zh, en } from "./dicts.js";
import { STYLE_TEXT } from "./styles.js";
import {
	normalizeTopProcess,
	normalizeMetrics,
	normalizeCleanup,
	normalizeBenchmark,
	normalizeParam,
	normalizeAction,
	normalizeActions,
	normalizeHistoryEntry,
	normalizeHistory,
	mergeHistory,
} from "./normalizers.js";
import {
	API_BASE,
	REQUEST_HEADERS,
	readResponseBody,
	bodyError,
	getJson,
	api,
} from "./api.js";

/**
 * Build the client registration body. Called by `entry.js` after the loader
 * hands over `react`, so module evaluation never touches the platform seed.
 * @returns {{ inject: string[], apply: (ctx: object) => void }}
 */
export function createClient() {
	const React = getReact();
	const h = React.createElement;
	const useState = React.useState;
	const useEffect = React.useEffect;
	const useRef = React.useRef;
	const useCallback = React.useCallback;
	const Fragment = React.Fragment;

		// ------------------------------------------------------------------
		// Hooks.
		// ------------------------------------------------------------------
		function usePrefersReducedMotion() {
			const [reduced, setReduced] = useState(() => {
				try {
					return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
				} catch (_error) {
					return false;
				}
			});
			useEffect(() => {
				if (typeof matchMedia !== "function") return void 0;
				const query = matchMedia("(prefers-reduced-motion: reduce)");
				const onChange = () => setReduced(query.matches === true);
				if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
				else if (typeof query.addListener === "function") query.addListener(onChange);
				return () => {
					if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
					else if (typeof query.removeListener === "function") query.removeListener(onChange);
				};
			}, []);
			return reduced;
		}

		/**
		 * Poll `/metrics` every 2500 ms while mounted; manual `refresh()` kicks an
		 * immediate poll. Failures degrade to `stale` once data exists, `error`
		 * before the first successful read, and the loop keeps retrying.
		 */
		function useDeviceMetrics() {
			const [state, setState] = useState({ status: "loading", metrics: null, error: null, updatedAt: 0 });
			const aliveRef = useRef(true);
			const inFlightRef = useRef(false);
			const timerRef = useRef(null);
			const tickRef = useRef(null);
			const samplesRef = useRef({ cpu: [], memory: [], disk: [], rx: [], tx: [], battery: [] });
			const fetchOnce = useCallback(async () => {
				if (inFlightRef.current) return false;
				inFlightRef.current = true;
				try {
					const raw = await api.metrics();
					if (!aliveRef.current) return false;
					const metrics = normalizeMetrics(raw);
					const samples = samplesRef.current;
					pushSample(samples.cpu, metrics.cpu.usagePercent, MAX_SAMPLES);
					pushSample(samples.memory, percentOf(metrics.memory.usedBytes, metrics.memory.totalBytes), MAX_SAMPLES);
					pushSample(samples.disk, percentOf(metrics.disk.usedBytes, metrics.disk.totalBytes), MAX_SAMPLES);
					pushSample(samples.rx, metrics.network.rxBytesPerSec, MAX_SAMPLES);
					pushSample(samples.tx, metrics.network.txBytesPerSec, MAX_SAMPLES);
					pushSample(samples.battery, metrics.battery ? metrics.battery.percent : null, MAX_SAMPLES);
					setState({ status: "ready", metrics, error: null, updatedAt: Date.now() });
					return true;
				} catch (error) {
					if (!aliveRef.current) return false;
					setState((previous) => ({
						status: previous.metrics ? "stale" : "error",
						metrics: previous.metrics,
						error,
						updatedAt: previous.updatedAt,
					}));
					return false;
				} finally {
					inFlightRef.current = false;
				}
			}, []);
			useEffect(() => {
				aliveRef.current = true;
				let cancelled = false;
				let generation = 0;
				const tick = async () => {
					if (cancelled) return;
					const current = (generation += 1);
					if (timerRef.current !== null) {
						clearTimeout(timerRef.current);
						timerRef.current = null;
					}
					await fetchOnce();
					if (cancelled || current !== generation) return;
					timerRef.current = setTimeout(tick, POLL_MS);
				};
				tickRef.current = tick;
				tick();
				return () => {
					cancelled = true;
					aliveRef.current = false;
					tickRef.current = null;
					if (timerRef.current !== null) clearTimeout(timerRef.current);
				};
			}, [fetchOnce]);
			const refresh = useCallback(() => {
				if (tickRef.current) return tickRef.current();
				return fetchOnce();
			}, [fetchOnce]);
			return { status: state.status, metrics: state.metrics, error: state.error, updatedAt: state.updatedAt, samples: samplesRef.current, refresh };
		}

		// ------------------------------------------------------------------
		// Small presentational primitives.
		// ------------------------------------------------------------------
		class Guard extends React.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
				this.retry = this.retry.bind(this);
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error, info) {
				try {
					console.error("[devicex] widget failed:", error, info);
				} catch (_ignored) {
					/* ignore logging failures */
				}
			}
			retry() {
				this.setState({ failed: false });
			}
			render() {
				if (this.state.failed) {
					const t = typeof this.props.t === "function" ? this.props.t : FALLBACK_T;
					return h(
						"div",
						{ className: "dx-guard", role: "alert" },
						h("p", { className: "dx-guardTitle" }, t("guard.title")),
						h("button", { type: "button", className: "dx-btn", onClick: this.retry }, t("guard.retry")),
					);
				}
				return this.props.children;
			}
		}

		/**
		 * Accessible modal: mask + panel, Escape closes, focus moves to the first
		 * control on open and returns to the opener on close, Tab is trapped inside.
		 */
		function Modal(props) {
			const t = typeof props.t === "function" ? props.t : FALLBACK_T;
			const rootRef = useRef(null);
			const closeRef = useRef(props.onClose);
			const confirmRef = useRef(props.onConfirm);
			closeRef.current = props.onClose;
			confirmRef.current = props.onConfirm;
			const seed = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
			const titleId = "dx-modal-title-" + seed;
			useEffect(() => {
				const root = rootRef.current;
				const previous = typeof document !== "undefined" ? document.activeElement : null;
				const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 0);
				const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
				const focusFirst = () => {
					if (!root) return;
					const target = root.querySelector("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href]");
					try {
						if (target && typeof target.focus === "function") target.focus();
						else if (typeof root.focus === "function") root.focus();
					} catch (_error) {
						/* focus is best-effort */
					}
				};
				const frame = raf(focusFirst);
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						if (closeRef.current) closeRef.current();
						return;
					}
					if (event.key !== "Tab" || !root) return;
					const focusable = Array.prototype.slice.call(
						root.querySelectorAll("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href]"),
					);
					if (focusable.length === 0) {
						event.preventDefault();
						return;
					}
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					const active = document.activeElement;
					if (event.shiftKey && (active === first || !root.contains(active))) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && (active === last || !root.contains(active))) {
						event.preventDefault();
						first.focus();
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					cancel(frame);
					document.removeEventListener("keydown", onKeyDown, true);
					try {
						if (previous && typeof previous.focus === "function") previous.focus();
					} catch (_error) {
						/* focus is best-effort */
					}
				};
			}, []);
			const details = asArray(props.details).filter((entry) => isObj(entry));
			return h(
				"div",
				{ className: "dx-modalRoot" },
				h("div", {
					className: "dx-modalMask",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget && closeRef.current) closeRef.current();
					},
				}),
				h(
					"div",
					{ className: "dx-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1, ref: rootRef },
					h(
						"div",
						{ className: "dx-modalHead" },
						h("h2", { className: "dx-modalTitle", id: titleId }, props.title),
						h(
							"button",
							{
								type: "button",
								className: "dx-btn dx-modalClose",
								"data-size": "icon",
								"aria-label": t("aria.close"),
								onClick: () => closeRef.current && closeRef.current(),
							},
							h(Icon, { name: "close", size: 14 }),
						),
					),
					h(
						"div",
						{ className: "dx-modalBody" },
						props.description ? h("p", null, props.description) : null,
						details.length > 0
							? h(
									"div",
									{ className: "dx-modalDetails" },
									details.map((entry, index) =>
										h(
											"div",
											{ className: "dx-modalDetailRow", key: index },
											h("span", { className: "dx-modalDetailLabel" }, entry.label),
											h("span", { className: "dx-modalDetailValue" }, entry.value),
										),
									),
								)
							: null,
						props.children || null,
						props.errorText ? h("p", { className: "dx-inlineError", role: "alert", style: { marginTop: "10px" } }, props.errorText) : null,
					),
					h(
						"div",
						{ className: "dx-modalFooter" },
						h(
							"button",
							{ type: "button", className: "dx-btn", onClick: () => closeRef.current && closeRef.current(), disabled: props.busy === true },
							props.cancelLabel || t("common.cancel"),
						),
						h(
							"button",
							{
								type: "button",
								className: "dx-btn",
								"data-variant": props.danger ? "danger" : "primary",
								onClick: () => confirmRef.current && confirmRef.current(),
								disabled: props.busy === true,
							},
							props.busy === true ? t("common.pending") : props.confirmLabel || t("common.confirm"),
						),
					),
				),
			);
		}

		function ToastItem(props) {
			const t = props.t;
			const toast = props.toast;
			useEffect(() => {
				const timer = setTimeout(() => props.onDismiss(toast.id), toast.tone === "fail" ? 6500 : 4200);
				return () => clearTimeout(timer);
			}, [toast.id, toast.tone, props.onDismiss]);
			return h(
				"div",
				{ className: "dx-toast", "data-tone": toast.tone },
				h("span", { className: "dx-toastIcon" }, h(Icon, { name: toast.tone === "ok" ? "check" : "warning", size: 16 })),
				h(
					"div",
					{ className: "dx-toastBody" },
					h("div", { className: "dx-toastTitle" }, toast.title),
					toast.message ? h("div", { className: "dx-toastMsg" }, toast.message) : null,
				),
				h(
					"button",
					{ type: "button", className: "dx-btn", "data-size": "icon", "aria-label": t("toast.dismiss"), onClick: () => props.onDismiss(toast.id) },
					h(Icon, { name: "close", size: 13 }),
				),
			);
		}

		function Toasts(props) {
			const toasts = asArray(props.toasts);
			if (toasts.length === 0) return null;
			return h(
				"div",
				{ className: "dx-toasts", role: "status", "aria-live": "polite" },
				toasts.map((toast) => h(ToastItem, { key: toast.id, t: props.t, toast, onDismiss: props.onDismiss })),
			);
		}



		// ------------------------------------------------------------------
		// Shared tab shell: loading skeleton, section-level error with retry,
		// non-fatal `errors[]` note, then the body.
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Hardware
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// System
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Software
		// ------------------------------------------------------------------

		/** Tiny helper for banner icons. */
		// ------------------------------------------------------------------
		// Network
		// ------------------------------------------------------------------

		// ------------------------------------------------------------------
		// Security
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Processes
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Action catalogue helpers
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Hardware: thermals + read-only driver inventory.
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Cleanup: allowlisted scan + explicit, confirmed deletion.
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Benchmark: fixed-work, repeatable, on demand.
		// ------------------------------------------------------------------
		function actionMetaOf(action) {
			const known = ACTION_META[action.id];
			if (known) {
				return { group: action.group, danger: action.danger, requiresAdmin: action.requiresAdmin, icon: known.icon, labelKey: known.labelKey, descKey: known.descKey };
			}
			return { group: action.group, danger: action.danger, requiresAdmin: action.requiresAdmin, icon: "actions", labelKey: null, descKey: null };
		}
		function actionLabel(t, id) {
			const meta = ACTION_META[id];
			return meta ? t(meta.labelKey) : id;
		}
		function paramLabel(t, param) {
			const key = PARAM_LABEL_KEYS[param.name];
			return key ? t(key) : param.name;
		}
		function optionLabel(t, value) {
			const text = String(value);
			const key = OPTION_LABEL_KEYS[text];
			return key ? t(key) : text;
		}
		function defaultParamValues(action) {
			const values = {};
			for (const param of asArray(action.params)) {
				if (param.type === "boolean") values[param.name] = false;
				else if (param.type === "select") values[param.name] = asArray(param.options).length > 0 ? String(param.options[0]) : "";
				else values[param.name] = "";
			}
			return values;
		}
		function validateActionParams(t, action, values) {
			const errors = {};
			const source = asObject(values);
			for (const param of asArray(action.params)) {
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
					if (!isFinite(numeric) || (param.min !== null && numeric < param.min) || (param.max !== null && numeric > param.max)) {
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
		function paramDisplayValue(t, param, values) {
			const raw = asObject(values)[param.name];
			if (param.type === "boolean") return raw === true ? t("common.on") : t("common.off");
			if (raw === null || raw === undefined || String(raw).length === 0) return "—";
			if (param.type === "select") return optionLabel(t, raw);
			return String(raw);
		}

		function ParamField(props) {
			const t = props.t;
			const param = props.param;
			const value = props.value;
			const id = "dx-param-" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
			const label = paramLabel(t, param);
			const placeholder = PARAM_PLACEHOLDER_KEYS[param.name] ? t(PARAM_PLACEHOLDER_KEYS[param.name]) : "";
			const error = props.error;
			if (param.type === "boolean") {
				return h(
					"div",
					{ className: "dx-field" },
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" } },
						h("label", { className: "dx-fieldLabel", htmlFor: id }, label),
						h(Switch, { checked: value === true, label, onChange: () => props.onChange(value !== true), disabled: props.disabled === true }),
					),
					error ? h("span", { className: "dx-fieldError" }, error) : null,
				);
			}
			let control = null;
			if (param.type === "select") {
				const options = asArray(param.options);
				control = h(
					"select",
					{ id, className: "dx-select", value: value === null || value === undefined ? "" : String(value), onChange: (event) => props.onChange(event.target.value) },
					h("option", { value: "" }, t("act.selectPlaceholder")),
					options.map((option) => h("option", { key: String(option), value: String(option) }, optionLabel(t, option))),
				);
			} else if (param.type === "number") {
				control = h("input", {
					id,
					type: "number",
					className: "dx-input",
					value: value === null || value === undefined ? "" : String(value),
					min: param.min === null ? undefined : param.min,
					max: param.max === null ? undefined : param.max,
					placeholder,
					inputMode: "numeric",
					onChange: (event) => props.onChange(event.target.value),
				});
			} else {
				control = h("input", {
					id,
					type: "text",
					className: "dx-input",
					value: value === null || value === undefined ? "" : String(value),
					placeholder,
					onChange: (event) => props.onChange(event.target.value),
				});
			}
			return h(
				"div",
				{ className: "dx-field" },
				h(
					"label",
					{ className: "dx-fieldLabel", htmlFor: id },
					label,
					param.required ? h("span", { "aria-hidden": "true", style: { marginLeft: "3px" } }, "*") : null,
				),
				control,
				error ? h("span", { className: "dx-fieldError", role: "alert" }, error) : null,
			);
		}

		function ActionCard(props) {
			const t = props.t;
			const action = props.action;
			const meta = props.meta;
			const values = asObject(props.values);
			const errors = asObject(props.errors);
			const pending = props.pending === true;
			const dangerKey = DANGER_LABEL_KEYS[meta.danger] || DANGER_LABEL_KEYS.low;
			return h(
				"article",
				{ className: "dx-actionCard" },
				h(
					"div",
					{ className: "dx-actionHead" },
					h("span", { className: "dx-actionIcon" }, h(Icon, { name: meta.icon, size: 16 })),
					h(
						"div",
						{ className: "dx-actionTitles" },
						h("h3", { className: "dx-actionTitle" }, meta.labelKey ? t(meta.labelKey) : action.id),
						meta.descKey ? h("p", { className: "dx-actionDesc" }, t(meta.descKey)) : null,
						h(
							"div",
							{ className: "dx-actionBadges" },
							h(Pill, { tone: meta.danger === "high" ? "error" : meta.danger === "medium" ? "warn" : "idle" }, t(dangerKey)),
							meta.requiresAdmin ? h(Pill, { tone: "warn" }, h(Icon, { name: "lock", size: 10 }), t("act.requiresAdmin")) : null,
						),
					),
				),
				asArray(action.params).length > 0
					? h(
							"div",
							{ className: "dx-actionParams" },
							asArray(action.params).map((param) =>
								h(ParamField, {
									key: param.name,
									t,
									param,
									value: values[param.name],
									error: errors[param.name],
									disabled: pending,
									onChange: (next) => props.onChange(param.name, next),
								}),
							),
						)
					: h("p", { className: "dx-small dx-muted" }, t("act.noParams")),
				h(
					"div",
					{ className: "dx-actionFooter" },
					h(
						"button",
						{
							type: "button",
							className: "dx-btn",
							"data-variant": meta.danger === "high" ? "danger" : "primary",
							disabled: pending,
							onClick: () => props.onRun(action, values),
						},
						pending ? t("act.pending") : h(Fragment, null, h(Icon, { name: "actions", size: 13 }), t("act.run")),
					),
				),
			);
		}

		function ActionsTab(props) {
			const t = props.t;
			const pending = asObject(props.pending);
			const catalog = asObject(props.catalog);
			const actions = asArray(catalog.actions);
			const [values, setValues] = useState({});
			const [errors, setErrors] = useState({});
			useEffect(() => {
				setValues((previous) => {
					const next = Object.assign({}, previous);
					let changed = false;
					for (const action of actions) {
						if (next[action.id] === undefined) {
							next[action.id] = defaultParamValues(action);
							changed = true;
						}
					}
					return changed ? next : previous;
				});
			}, [actions]);
			if (catalog.status === "loading" || catalog.status === "idle") return h(Skeleton, { cards: 4 });
			if (catalog.status === "error") {
				return h(ErrorState, {
					t,
					title: t("error.section"),
					text: t("error.sectionHint") + (catalog.error ? " (" + safeErrorText(catalog.error) + ")" : ""),
					onRetry: props.onRetry,
					retryLabel: t("common.retry"),
				});
			}
			const extraGroups = [];
			for (const action of actions) {
				if (ACTION_GROUPS.indexOf(action.group) < 0 && extraGroups.indexOf(action.group) < 0) extraGroups.push(action.group);
			}
			const groups = ACTION_GROUPS.concat(extraGroups);
			const history = asArray(props.history);
			const setActionValue = (actionId, name, next) => {
				setValues((previous) => Object.assign({}, previous, { [actionId]: Object.assign({}, asObject(previous[actionId]), { [name]: next }) }));
				setErrors((previous) => {
					const forAction = Object.assign({}, asObject(previous[actionId]));
					if (!forAction[name]) return previous;
					delete forAction[name];
					return Object.assign({}, previous, { [actionId]: forAction });
				});
			};
			const runAction = (action, currentValues) => {
				const meta = actionMetaOf(action);
				const actionErrors = validateActionParams(t, action, currentValues);
				if (Object.keys(actionErrors).length > 0) {
					setErrors((previous) => Object.assign({}, previous, { [action.id]: actionErrors }));
					return;
				}
				// The DNS action's `servers` parameter is an array on the wire while
				// the generic form edits it as text; parse and validate it here.
				let params = currentValues;
				if (action.id === "network.setDns") {
					const servers = parseServerList(asObject(currentValues).servers);
					if (servers.length > 4 || servers.some((server) => !isIpv4(server))) {
						setErrors((previous) => Object.assign({}, previous, { [action.id]: { servers: t("net.dnsInvalid") } }));
						return;
					}
					params = Object.assign({}, currentValues, { servers });
				}
				setErrors((previous) => Object.assign({}, previous, { [action.id]: {} }));
				const details = asArray(action.params).map((param) => ({ label: paramLabel(t, param), value: paramDisplayValue(t, param, currentValues) }));
				props.openConfirm({
					title: t("act.runTitle", { action: meta.labelKey ? t(meta.labelKey) : action.id }),
					description: t("act.runBody"),
					details,
					confirmLabel: t("act.run"),
					danger: meta.danger === "high" || meta.requiresAdmin === true,
					actionId: action.id,
					params,
				});
			};
			return h(
				"div",
				{ className: "dx-section" },
				h(
					"div",
					{ className: "dx-toolbar" },
					h("div", { className: "dx-toolbarLeft" }, h(SectionHead, { title: t("act.catalog"), subtitle: String(actions.length) })),
					h("div", { className: "dx-toolbarRight" }, h("span", { className: "dx-small dx-muted" }, t("act.footerHint"))),
				),
				groups.map((group) => {
					const groupActions = actions.filter((action) => action.group === group);
					if (groupActions.length === 0) return null;
					const groupKey = GROUP_LABEL_KEYS[group];
					return h(
						"section",
						{ className: "dx-actionGroup", key: group },
						h(SectionHead, { title: groupKey ? t(groupKey) : group, subtitle: String(groupActions.length) }),
						h(
							"div",
							{ className: "dx-actionGrid" },
							groupActions.map((action) => {
								const meta = actionMetaOf(action);
								return h(ActionCard, {
									key: action.id,
									t,
									action,
									meta,
									values: asObject(values[action.id]),
									errors: asObject(errors[action.id]),
									pending: pending[action.id] === true,
									onChange: (name, next) => setActionValue(action.id, name, next),
									onRun: runAction,
								});
							}),
						),
					);
				}),
				h(Card, {
					title: t("act.history"),
					icon: "clock",
					subtitle: history.length > 0 ? String(history.length) : "",
					children:
						history.length === 0
							? h(EmptyState, { icon: "clock", title: t("act.historyEmpty") })
							: h(
									"div",
									{ className: "dx-history" },
									history.map((entry, index) =>
										h(
											"div",
											{ className: "dx-historyRow", key: String(entry.ts) + "-" + entry.id + "-" + index },
											h("span", { className: "dx-historyDot", "data-tone": entry.ok ? "ok" : "fail" }),
											h(
												"div",
												{ className: "dx-historyMain" },
												h(
													"div",
													{ className: "dx-historyTop" },
													h("span", { className: "dx-historyAction" }, actionLabel(t, entry.id)),
													h("span", { className: "dx-historyMeta", title: fmtDateTime(entry.ts) }, fmtTime(entry.ts)),
													h(Pill, { tone: entry.ok ? "ok" : "error" }, entry.ok ? t("act.historyOk") : t("act.historyFail")),
												),
												entry.message ? h("div", { className: "dx-historyMsg" }, entry.message) : null,
											),
										),
									),
								),
				}),
			);
		}

		// ------------------------------------------------------------------
		// The page
		// ------------------------------------------------------------------
		const SECTION_COMPONENTS = {
			hardware: HardwareTab,
			system: SystemTab,
			software: SoftwareTab,
			network: NetworkTab,
			security: SecurityTab,
			processes: ProcessesTab,
		};

		function DeviceXPage(props) {
			const t = typeof props.t === "function" ? props.t : FALLBACK_T;
			const metricsState = useDeviceMetrics();
			const refreshMetrics = metricsState.refresh;
			const metrics = metricsState.metrics;
			const reducedMotion = usePrefersReducedMotion();
			const [activeTab, setActiveTab] = useState("overview");
			const [threeD, setThreeD] = useState(true);
			const [sections, setSections] = useState({});
			const [catalog, setCatalog] = useState({ status: "idle", actions: [], history: [], platform: null, error: null });
			const [liveHistory, setLiveHistory] = useState([]);
			const [modal, setModal] = useState(null);
			const [modalBusy, setModalBusy] = useState(false);
			const [modalError, setModalError] = useState("");
			const [toasts, setToasts] = useState([]);
			const [pending, setPending] = useState({});
			const [refreshing, setRefreshing] = useState(false);
			const sectionsInFlight = useRef({});
			const sectionRetried = useRef({});
			const prefetchStarted = useRef(false);
			const retryTimers = useRef([]);
			const catalogInFlight = useRef(null);
			const toastId = useRef(0);
			const tabRefs = useRef([]);
			const baseId = "dx-" + React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
			const panelId = baseId + "-panel-" + activeTab;

			const pushToast = useCallback((tone, title, message) => {
				toastId.current += 1;
				const id = toastId.current;
				setToasts((previous) => previous.concat([{ id, tone, title, message: strOr(message, "") }]).slice(-4));
			}, []);
			const dismissToast = useCallback((id) => {
				setToasts((previous) => previous.filter((toast) => toast.id !== id));
			}, []);

			const appendHistory = useCallback((entry) => {
				const normalized = normalizeHistoryEntry(entry);
				if (!normalized) return;
				setLiveHistory((previous) =>
					[normalized]
						.concat(
							asArray(previous).filter(
								(existing) => !(existing.ts === normalized.ts && existing.id === normalized.id && existing.message === normalized.message),
							),
						)
						.slice(0, 50),
				);
			}, []);

			const loadSection = useCallback((section, fresh) => {
				if (!section) return Promise.resolve();
				if (sectionsInFlight.current[section]) return sectionsInFlight.current[section];
				setSections((previous) => {
					const existing = asObject(previous[section]);
					return Object.assign({}, previous, {
						[section]: { status: "loading", data: existing.data === undefined ? null : existing.data, error: null, fetchedAt: numOr(existing.fetchedAt, 0) },
					});
				});
				const promise = api
					.section(section, fresh === true)
					.then((data) => {
						setSections((previous) => ({
							...previous,
							[section]: { status: "ready", data: isObj(data) ? data : {}, error: null, fetchedAt: Date.now() },
						}));
					})
					.catch((error) => {
						setSections((previous) => {
							const existing = asObject(previous[section]);
							return Object.assign({}, previous, {
								[section]: { status: "error", data: existing.data === undefined ? null : existing.data, error, fetchedAt: numOr(existing.fetchedAt, 0) },
							});
						});
					})
					.finally(() => {
						delete sectionsInFlight.current[section];
					});
				sectionsInFlight.current[section] = promise;
				return promise;
			}, []);

			const invalidateSections = useCallback((exceptSection) => {
				setSections((previous) => {
					const next = {};
					let changed = false;
					for (const key of Object.keys(previous)) {
						if (key === exceptSection) {
							next[key] = previous[key];
							continue;
						}
						if (previous[key].status === "idle") {
							next[key] = previous[key];
							continue;
						}
						next[key] = Object.assign({}, previous[key], { status: "idle" });
						changed = true;
					}
					return changed ? next : previous;
				});
			}, []);

			const loadCatalog = useCallback((fresh) => {
				if (catalogInFlight.current) return catalogInFlight.current;
				setCatalog((previous) => Object.assign({}, previous, { status: previous.actions.length > 0 ? "ready" : "loading", error: null }));
				const promise = api
					.actions()
					.then((result) => {
						setCatalog({
							status: "ready",
							actions: normalizeActions(result.actions),
							history: normalizeHistory(result.history),
							platform: typeof result.platform === "string" ? result.platform : null,
							error: null,
						});
					})
					.catch((error) => {
						setCatalog((previous) => Object.assign({}, previous, { status: previous.actions.length > 0 ? "ready" : "error", error }));
					})
					.finally(() => {
						catalogInFlight.current = null;
					});
				catalogInFlight.current = promise;
				return promise;
			}, []);

			// Lazy section fetch per tab; the cache survives tab switches.
			// A transient failure on the very first (cold) request is retried once
			// automatically, so a slow Windows PowerShell start does not leave the
			// tab stuck on an error until the user navigates away and back.
			useEffect(() => {
				const section = SECTION_TABS[activeTab];
				if (!section) return;
				const current = sections[section];
				if (!current || current.status === "idle") {
					loadSection(section, false);
					return;
				}
				if (current.status === "error" && !current.data && sectionRetried.current[section] !== true) {
					sectionRetried.current[section] = true;
					const timer = setTimeout(() => {
						loadSection(section, true);
					}, 1500);
					retryTimers.current.push(timer);
				}
			}, [activeTab, sections, loadSection]);

			useEffect(() => {
				return () => {
					for (const timer of retryTimers.current) clearTimeout(timer);
					retryTimers.current = [];
				};
			}, []);

			// Warm every section once after the panel appears. On Windows the first
			// PowerShell sample of a section can take seconds; prefetching means the
			// first click on a tab usually renders already-cached data instead of
			// showing a long loading state. Requests are staggered and the Host
			// deduplicates them against its own warmup.
			useEffect(() => {
				if (prefetchStarted.current) return;
				prefetchStarted.current = true;
				const timers = [];
				Object.values(SECTION_TABS).forEach((section, index) => {
					const timer = setTimeout(() => {
						if (!sectionsInFlight.current[section]) loadSection(section, false);
					}, 150 + index * 250);
					timers.push(timer);
				});
				return () => {
					for (const timer of timers) clearTimeout(timer);
				};
			}, [loadSection]);

			// The catalogue also supplies action metadata (pane allowlists) used by
			// other tabs, so warm it once; the Actions tab offers its own retry.
			useEffect(() => {
				loadCatalog(false);
			}, [loadCatalog]);

			const executeAction = useCallback(
				async (actionId, params) => {
					if (!actionId) return { ok: false, message: "" };
					setPending((previous) => Object.assign({}, previous, { [actionId]: true }));
					const label = actionLabel(t, actionId);
					let result;
					try {
						result = await api.runAction(actionId, params);
					} catch (error) {
						result = { ok: false, message: safeErrorText(error) };
					}
					try {
						const message = strOr(result.message, "");
						pushToast(result.ok ? "ok" : "fail", t(result.ok ? "toast.action.ok" : "toast.action.fail", { action: label }), message);
						appendHistory({ ts: Date.now(), id: actionId, params: params || {}, ok: result.ok === true, message });
						if (result.ok) {
							const section = SECTION_TABS[activeTab];
							invalidateSections(section);
							if (section) loadSection(section, true);
						}
						refreshMetrics();
					} finally {
						setPending((previous) => {
							const next = Object.assign({}, previous);
							delete next[actionId];
							return next;
						});
					}
					return result;
				},
				[t, pushToast, appendHistory, invalidateSections, loadSection, refreshMetrics, activeTab],
			);

			const openConfirm = useCallback((config) => {
				setModal(Object.assign({ kind: "confirm" }, config));
				setModalError("");
			}, []);
			const openDns = useCallback((service, servers) => {
				setModal({ kind: "dns", values: { service: strOr(service, "Wi-Fi"), servers: asArray(servers).filter((entry) => typeof entry === "string").join(", ") } });
				setModalError("");
			}, []);
			const openKill = useCallback((target) => {
				const source = asObject(target);
				setModal({ kind: "kill", pid: numOr(source.pid, 0), name: strOr(source.name, ""), values: { signal: strOr(source.signal, "TERM") } });
				setModalError("");
			}, []);
			const setModalValue = useCallback((name, value) => {
				setModal((previous) => (previous ? Object.assign({}, previous, { values: Object.assign({}, asObject(previous.values), { [name]: value }) }) : previous));
			}, []);
			const closeModal = useCallback(() => {
				setModal((current) => {
					if (modalBusy && current) return current;
					setModalError("");
					return null;
				});
			}, [modalBusy]);

			const resolvePane = useCallback(
				(matchers, fallback) => {
					const openSettings = asArray(catalog.actions).find((action) => action.id === "system.openSettings");
					const paneParam = openSettings ? asArray(openSettings.params).find((param) => param.name === "pane") : null;
					const options = paneParam ? asArray(paneParam.options) : [];
					for (const matcher of asArray(matchers)) {
						const needle = String(matcher).toLowerCase();
						const found = options.find((option) => String(option).toLowerCase().indexOf(needle) >= 0);
						if (found !== undefined) return found;
					}
					return fallback;
				},
				[catalog.actions],
			);
			const openPane = useCallback(
				(matchers, fallback) => {
					executeAction("system.openSettings", { pane: resolvePane(matchers, fallback) });
				},
				[executeAction, resolvePane],
			);

			const commitModal = useCallback(async () => {
				const current = modal;
				if (!current || modalBusy) return;
				if (current.kind === "dns") {
					const values = asObject(current.values);
					const service = String(values.service === undefined || values.service === null ? "" : values.service).trim();
					const servers = parseServerList(values.servers);
					const invalid = servers.filter((server) => !isIpv4(server));
					if (service.length === 0) {
						setModalError(t("act.invalidRequired", { name: t("net.dnsService") }));
						return;
					}
					if (servers.length > 4 || invalid.length > 0) {
						setModalError(t("net.dnsInvalid"));
						return;
					}
					setModalBusy(true);
					const result = await executeAction("network.setDns", { service, servers });
					setModalBusy(false);
					if (result && result.ok) {
						pushToast("ok", t("net.dnsApplied", { service }), "");
						setModal(null);
						setModalError("");
					} else {
						setModalError(strOr(result && result.message, t("error.sectionHint")));
					}
					return;
				}
				let actionId = current.actionId;
				let params = current.params;
				if (current.kind === "kill") {
					actionId = "process.signal";
					params = { pid: current.pid, signal: strOr(asObject(current.values).signal, "TERM") };
				}
				if (!actionId) {
					setModal(null);
					return;
				}
				setModalBusy(true);
				const result = await executeAction(actionId, params || {});
				setModalBusy(false);
				setModal(null);
				setModalError("");
				if (result && result.ok === false && result.message) setModalError("");
			}, [modal, modalBusy, executeAction, pushToast, t]);

			const manualRefresh = useCallback(async () => {
				if (refreshing) return;
				setRefreshing(true);
				const section = SECTION_TABS[activeTab];
				const tasks = [refreshMetrics()];
				if (section) {
					invalidateSections(section);
					tasks.push(loadSection(section, true));
				}
				if (activeTab === "actions" || asArray(catalog.actions).length === 0) tasks.push(loadCatalog(true));
				try {
					await Promise.allSettled(tasks);
				} finally {
					setRefreshing(false);
				}
			}, [refreshing, activeTab, refreshMetrics, loadSection, loadCatalog, invalidateSections, catalog.actions]);

			const focusTab = (index) => {
				const target = TAB_IDS[index];
				if (!target) return;
				setActiveTab(target);
				const node = tabRefs.current[index];
				if (node && typeof node.focus === "function") {
					try {
						node.focus();
					} catch (_error) {
						/* focus is best-effort */
					}
				}
			};
			const onRailKeyDown = (event) => {
				const index = TAB_IDS.indexOf(activeTab);
				if (index < 0) return;
				let next = -1;
				if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % TAB_IDS.length;
				else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = TAB_IDS.length - 1;
				if (next >= 0) {
					event.preventDefault();
					focusTab(next);
				}
			};

			// ---- modal content -------------------------------------------------
			const modalContent = (() => {
				if (!modal) return null;
				if (modal.kind === "dns") {
					const values = asObject(modal.values);
					return {
						title: t("net.dnsTitle"),
						description: t("net.dnsBody", { service: strOr(values.service, "Wi-Fi") }),
						confirmLabel: t("net.setDns"),
						danger: false,
						children: h(
							"div",
							{ className: "dx-modalFields" },
							h(
								"div",
								{ className: "dx-field" },
								h("label", { className: "dx-fieldLabel", htmlFor: baseId + "-dns-service" }, t("net.dnsService")),
								h("input", {
									id: baseId + "-dns-service",
									type: "text",
									className: "dx-input",
									value: strOr(values.service, ""),
									placeholder: t("act.paramPlaceholder.service"),
									onChange: (event) => setModalValue("service", event.target.value),
								}),
							),
							h(
								"div",
								{ className: "dx-field" },
								h("label", { className: "dx-fieldLabel", htmlFor: baseId + "-dns-servers" }, t("net.dnsServers")),
								h("textarea", {
									id: baseId + "-dns-servers",
									className: "dx-textarea",
									value: strOr(values.servers, ""),
									placeholder: t("net.dnsServersPlaceholder"),
									onChange: (event) => setModalValue("servers", event.target.value),
								}),
							),
						),
					};
				}
				if (modal.kind === "kill") {
					const signal = strOr(asObject(modal.values).signal, "TERM");
					const pid = numOr(modal.pid, 0);
					// The Host catalogue is authoritative: macOS exposes five signals,
					// Windows only TERM/KILL/INT. Fall back to the full set before load.
					const signalAction = asArray(catalog.actions).find((entry) => entry.id === "process.signal");
					const signalParam = signalAction ? asArray(signalAction.params).find((param) => param.name === "signal") : null;
					const catalogSignals = signalParam ? asArray(signalParam.options).filter((option) => typeof option === "string") : [];
					const killSignals = catalogSignals.length > 0 ? catalogSignals : SIGNALS;
					return {
						title: t("proc.confirmTitle", { name: strOr(modal.name, "—") }),
						description: t("proc.confirmBody", { name: strOr(modal.name, "—"), pid, signal: optionLabel(t, signal) }),
						confirmLabel: t("proc.kill"),
						danger: true,
						children: h(
							"div",
							{ className: "dx-modalFields" },
							h(
								"div",
								{ className: "dx-field" },
								h("label", { className: "dx-fieldLabel", htmlFor: baseId + "-kill-signal" }, t("proc.signal")),
								h(
									"select",
									{ id: baseId + "-kill-signal", className: "dx-select", value: signal, onChange: (event) => setModalValue("signal", event.target.value) },
									killSignals.map((option) => h("option", { key: option, value: option }, optionLabel(t, option))),
								),
							),
						),
					};
				}
				return {
					title: strOr(modal.title, t("dialog.title")),
					description: strOr(modal.description, ""),
					details: asArray(modal.details),
					confirmLabel: strOr(modal.confirmLabel, t("common.confirm")),
					danger: modal.danger === true,
					children: null,
				};
			})();

			// ---- body ----------------------------------------------------------
			const sectionKey = SECTION_TABS[activeTab];
			const sectionState = sectionKey ? sections[sectionKey] || { status: "idle", data: null, error: null } : null;
			const connectionFailed = metricsState.status === "error" && !metrics;
			let body = null;
			if (connectionFailed) {
				body = h(ErrorState, {
					t,
					title: t("error.title"),
					text: t("error.body"),
					onRetry: refreshMetrics,
					retryLabel: t("common.retry"),
				});
			} else if (activeTab === "overview") {
				body = h(OverviewTab, {
					t,
					metrics,
					samples: metricsState.samples,
					threeD,
					onShowProcesses: () => setActiveTab("processes"),
				});
			} else if (activeTab === "actions") {
				body = h(ActionsTab, {
					t,
					catalog,
					history: mergeHistory(liveHistory, catalog.history),
					pending,
					onRetry: () => loadCatalog(true),
					openConfirm,
				});
			} else if (activeTab === "cleanup") {
				body = h(CleanupTab, { t, onAction: executeAction });
			} else if (activeTab === "benchmark") {
				body = h(BenchmarkTab, { t });
			} else {
				const TabComponent = SECTION_COMPONENTS[activeTab];
				body = TabComponent
					? h(TabComponent, {
							t,
							state: sectionState,
							metrics,
							platform: catalog.platform,
							pending,
							onRetry: () => loadSection(activeTab, true),
							onRefresh: () => loadSection(activeTab, true),
							onAction: executeAction,
							openConfirm,
							openDns,
							openKill,
							openPane,
						})
					: h(EmptyState, { title: t("common.empty") });
			}

			const statusTone = metricsState.status;
			const statusKey = statusTone === "ready" ? "header.live" : statusTone === "stale" ? "header.stale" : statusTone === "error" ? "header.offline" : "header.connecting";
			const osChipText = metrics && metrics.osVersion ? metrics.osVersion : catalog.platform === "darwin" ? "macOS" : strOr(catalog.platform, "");
			const motionLabel = threeD ? t("header.motionOff") : t("header.motionOn");

			return h(
				"div",
				{ className: "dx-root", "data-motion": threeD && !reducedMotion ? "on" : "off" },
				h(
					"header",
					{ className: "dx-header" },
					h(
						"div",
						{ className: "dx-headerMain" },
						h(
							"div",
							{ className: "dx-titleRow" },
							h("h1", { className: "dx-title", title: metrics && metrics.hostname ? metrics.hostname : t("panel") }, (metrics && metrics.hostname) || t("panel")),
							osChipText ? h("span", { className: "dx-osChip" }, osChipText) : null,
						),
						h(
							"div",
							{ className: "dx-headerMeta" },
							h("span", { className: "dx-status", "data-state": statusTone, role: "status", "aria-label": t("aria.status") }, h("span", { className: "dx-statusDot", "aria-hidden": "true" }), t(statusKey)),
							metricsState.updatedAt > 0 ? h("span", null, t("header.updated", { time: fmtTime(metricsState.updatedAt) })) : null,
							metrics && metrics.uptimeSec !== null ? h("span", null, t("header.uptime") + " " + fmtUptime(metrics.uptimeSec, t)) : null,
						),
					),
					h(
						"div",
						{ className: "dx-headerActions" },
						h(
							"button",
							{
								type: "button",
								className: "dx-iconBtn",
								title: refreshing ? t("header.refreshing") : t("header.refresh"),
								"aria-label": t("aria.refresh"),
								disabled: refreshing,
								onClick: manualRefresh,
							},
							h(Icon, { name: "refresh", size: 15, className: refreshing ? "dx-spin" : undefined }),
						),
						h(
							"button",
							{
								type: "button",
								className: "dx-pillBtn",
								"aria-pressed": threeD,
								"aria-label": t("aria.motion"),
								title: motionLabel,
								onClick: () => setThreeD((value) => !value),
							},
							h(Icon, { name: "spark", size: 14 }),
							"3D",
						),
					),
				),
				h(
					"div",
					{ className: "dx-body" },
					h(
						"nav",
						{ className: "dx-rail", role: "tablist", "aria-label": t("aria.tabs"), "aria-orientation": "vertical", onKeyDown: onRailKeyDown },
						TAB_IDS.map((tab, index) =>
							h(
								"button",
								{
									key: tab,
									ref: (node) => {
										tabRefs.current[index] = node;
									},
									type: "button",
									role: "tab",
									id: baseId + "-tab-" + tab,
									"aria-selected": activeTab === tab,
									"aria-controls": baseId + "-panel-" + tab,
									tabIndex: activeTab === tab ? 0 : -1,
									className: "dx-railTab",
									onClick: () => setActiveTab(tab),
									onMouseEnter: () => {
										const section = SECTION_TABS[tab];
										if (section && (!sections[section] || sections[section].status === "idle")) loadSection(section, false);
									},
									onFocus: () => {
										const section = SECTION_TABS[tab];
										if (section && (!sections[section] || sections[section].status === "idle")) loadSection(section, false);
									},
								},
								h("span", { className: "dx-railIcon" }, h(Icon, { name: TAB_ICONS[tab], size: 15 })),
								h("span", { className: "dx-railLabel" }, t(TAB_LABEL_KEYS[tab])),
							),
						),
					),
					h(
						"div",
						{ className: "dx-contentWrap" },
						metricsState.status === "stale"
							? h(
									"div",
									{ className: "dx-banner", "data-tone": "warn", role: "status" },
									spanIcon("info"),
									h("span", { className: "dx-bannerText" }, t("error.stale")),
									h(
										"button",
										{ type: "button", className: "dx-btn", "data-size": "sm", onClick: manualRefresh, disabled: refreshing },
										t("error.staleRetry"),
									),
								)
							: null,
						h(
							"div",
							{ className: "dx-content" },
							h(
								"div",
								{ className: "dx-tabpanel", role: "tabpanel", id: panelId, "aria-labelledby": baseId + "-tab-" + activeTab },
								h(Guard, { t, key: activeTab }, body),
							),
						),
					),
				),
				modalContent
					? h(
							Modal,
							{
								t,
								title: modalContent.title,
								description: modalContent.description,
								details: modalContent.details,
								confirmLabel: modalContent.confirmLabel,
								danger: modalContent.danger,
								busy: modalBusy,
								errorText: modalError,
								onClose: closeModal,
								onConfirm: commitModal,
							},
							modalContent.children,
						)
					: null,
				h(Toasts, { t, toasts, onDismiss: dismissToast }),
			);
		}

		/** Sidebar entry glyph: a chip with an X, matching the page artwork. */
		function DeviceXIcon(props) {
			const size = numOr(props.size, 18);
			const active = props.active === true;
			return h(
				"svg",
				{ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" },
				active ? h("rect", { x: 3.5, y: 3.5, width: 17, height: 17, rx: 4.5, fill: "currentColor", stroke: "none", opacity: 0.12 }) : null,
				h("rect", { x: 4.5, y: 4.5, width: 15, height: 15, rx: 4 }),
				h("path", { d: "M9.5 9.5l5 5M14.5 9.5l-5 5" }),
				h("path", { d: "M9.5 2.5v2M14.5 2.5v2M9.5 19.5v2M14.5 19.5v2M2.5 9.5h2M2.5 14.5h2M19.5 9.5h2M19.5 14.5h2" }),
			);
		}

		// ------------------------------------------------------------------
		// Plugin registration
		// ------------------------------------------------------------------
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "devicex: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-devicex", "");
				style.textContent = STYLE_TEXT;
				document.head.appendChild(style);
				return () => {
					if (style.parentNode) style.parentNode.removeChild(style);
				};
			}, "devicex: styles");
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
					},
					DeviceXPage,
				),
			);
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 20,
						locale: NS,
						label: () => t("panel"),
					},
					DeviceXIcon,
				),
			);
		}

	return { inject: ["slots", "locale"], apply };
}
