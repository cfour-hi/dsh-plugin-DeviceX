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
	normalizeThermal,
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
		// Overview
		// ------------------------------------------------------------------
		const MEMORY_SEGMENTS = [
			{ key: "app", labelKey: "overview.breakdown.app", color: "var(--dsw-alias-brand-primary)" },
			{ key: "wired", labelKey: "overview.breakdown.wired", color: "var(--dsw-alias-state-warn-primary)" },
			{ key: "compressed", labelKey: "overview.breakdown.compressed", color: "var(--dsw-alias-state-error-primary)" },
			{ key: "cached", labelKey: "overview.breakdown.cached", color: "var(--dsw-alias-state-idle-primary)" },
			{ key: "free", labelKey: "overview.breakdown.free", color: "var(--dsw-alias-border-l2)" },
		];

		/** Derived alert chips for the Overview. Purely client-side heuristics. */
		function buildAlerts(t, metrics) {
			const alerts = [];
			if (!metrics) return alerts;
			const memory = metrics.memory;
			const memoryPercent = percentOf(memory.usedBytes, memory.totalBytes);
			if (memoryPercent !== null && memoryPercent > 85) {
				alerts.push({ key: "memory-high", icon: "memory", tone: memoryPercent >= 94 ? "error" : "warn", text: t("overview.alert.memoryHigh", { percent: fmtPercent(memoryPercent) }) });
			}
			if (memory.pressure !== "normal") {
				alerts.push({ key: "memory-pressure", icon: "memory", tone: memory.pressure === "critical" ? "error" : "warn", text: t("overview.alert.memoryPressure", { level: t(pressureKey(memory.pressure)) }) });
			}
			if (isFiniteNumber(memory.swapUsedBytes) && memory.swapUsedBytes > 1024 * 1024 * 1024) {
				alerts.push({ key: "swap", icon: "disk", tone: "warn", text: t("overview.alert.swap", { value: fmtBytes(memory.swapUsedBytes) }) });
			}
			const cpuPercent = metrics.cpu.usagePercent;
			if (cpuPercent !== null && cpuPercent > 90) {
				alerts.push({ key: "cpu-high", icon: "cpu", tone: "warn", text: t("overview.alert.cpuHigh", { percent: fmtPercent(cpuPercent) }) });
			}
			const diskPercent = percentOf(metrics.disk.usedBytes, metrics.disk.totalBytes);
			if (diskPercent !== null && diskPercent > 90) {
				alerts.push({ key: "disk-high", icon: "disk", tone: diskPercent >= 97 ? "error" : "warn", text: t("overview.alert.diskHigh", { percent: fmtPercent(diskPercent) }) });
			}
			const battery = metrics.battery;
			if (battery && battery.present && battery.percent !== null && battery.percent <= 20 && !battery.charging) {
				alerts.push({ key: "battery-low", icon: "battery", tone: "error", text: t("overview.alert.batteryLow", { percent: fmtPercent(battery.percent) }) });
			}
			const thermal = asObject(metrics.thermal);
			const readings = [thermal.cpuCelsius, thermal.gpuCelsius].filter((value) => isFiniteNumber(value));
			const temperature = readings.length > 0 ? Math.max(...readings) : null;
			if (temperature !== null && temperature >= 90) {
				alerts.push({ key: "thermal", icon: "warning", tone: "error", text: t("overview.alert.thermal", { temp: Math.round(temperature) }) });
			}
			return alerts;
		}

		/**
		 * Pure-CSS layered device core; decorative only (hidden from the a11y tree).
		 * Motion pauses when the window is hidden or the scene scrolls out of view,
		 * so the always-running CSS animation stops costing CPU when nobody sees it.
		 */
		function DeviceScene(props) {
			const sceneRef = useRef(null);
			const [inView, setInView] = useState(true);
			const [pageVisible, setPageVisible] = useState(true);
			useEffect(() => {
				const node = sceneRef.current;
				if (!node || typeof IntersectionObserver !== "function") return void 0;
				const observer = new IntersectionObserver((entries) => {
					for (const entry of entries) setInView(entry.isIntersecting === true);
				}, { threshold: 0 });
				observer.observe(node);
				return () => observer.disconnect();
			}, []);
			useEffect(() => {
				if (typeof document === "undefined") return void 0;
				const onChange = () => setPageVisible(document.hidden !== true);
				onChange();
				document.addEventListener("visibilitychange", onChange);
				return () => document.removeEventListener("visibilitychange", onChange);
			}, []);
			const ring = (layer, id) => h("div", { className: "dx-orbit", "data-layer": String(layer) }, h("div", { className: "dx-ring", "data-ring": String(id) }));
			const motion = props.animated !== false && inView && pageVisible ? "on" : "off";
			return h(
				"div",
				{ className: "dx-scene", "data-motion": motion, "aria-hidden": "true", ref: sceneRef },
				h("div", { className: "dx-sceneGlow" }),
				h("div", { className: "dx-sceneGrid" }),
				ring(1, 1),
				ring(2, 2),
				ring(3, 3),
				h(
					"div",
					{ className: "dx-chipScene" },
					h(
						"div",
						{ className: "dx-chipBody" },
						h("div", { className: "dx-chipPins" }, Array.from({ length: 12 }).map((_ignored, index) => h("span", { key: index }))),
						h("div", { className: "dx-chipGlow" }),
						h("div", { className: "dx-chipCore" }),
					),
				),
				[1, 2, 3, 4].map((particle) => h("span", { key: "particle-" + particle, className: "dx-particle", "data-p": String(particle) })),
				h("span", { className: "dx-sceneCaption" }, "DEVICE X"),
			);
		}

		function OverviewTab(props) {
			const t = props.t;
			const metrics = props.metrics;
			const samples = asObject(props.samples);
			const sampleList = (key) => asArray(samples[key]);
			if (!metrics) return h(Skeleton, { cards: 5 });
			const memory = metrics.memory;
			const disk = metrics.disk;
			const cpu = metrics.cpu;
			const network = metrics.network;
			const battery = metrics.battery;
			const memoryPercent = percentOf(memory.usedBytes, memory.totalBytes);
			const diskPercent = percentOf(disk.usedBytes, disk.totalBytes);
			const alerts = buildAlerts(t, metrics);
			const wifiLevel = network.wifi ? rssiLevel(network.wifi.rssi) : 0;
			const wifiQuality = network.wifi && network.wifi.rssi !== null ? clamp(((network.wifi.rssi + 100) / 70) * 100, 0, 100) : null;
			const batteryTone = battery && battery.percent !== null ? (battery.percent <= 20 ? "var(--dsw-alias-state-error-primary)" : battery.charging ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-brand-primary)") : "var(--dsw-alias-state-idle-primary)";
			const batterySub = !battery || battery.present === false
				? t("overview.kpi.noBattery")
				: battery.charging
					? t("overview.kpi.charging")
					: battery.plugged
						? t("overview.kpi.plugged")
						: battery.timeRemainingMin !== null
							? t("overview.kpi.remaining", { value: fmtUptime(battery.timeRemainingMin * 60, t) })
							: t("overview.kpi.onBattery");
			const heroChips = [
				h("span", { className: "dx-chip", key: "cores" }, h(Icon, { name: "cpu", size: 13 }), h("strong", null, String(numOr(cpu.logicalCores, 0))), t("hw.cores")),
				h("span", { className: "dx-chip", key: "uptime" }, h(Icon, { name: "clock", size: 13 }), t("sys.uptime"), h("strong", null, fmtUptime(metrics.uptimeSec, t))),
				h(
					"span",
					{ className: "dx-chip", "data-tone": memory.pressure === "normal" ? "ok" : memory.pressure === "warning" ? "warn" : "error", key: "pressure" },
					h(Icon, { name: "memory", size: 13 }),
					t("overview.kpi.pressure"),
					h("strong", null, t(pressureKey(memory.pressure))),
				),
			];
			const thermalNow = asObject(metrics.thermal);
			const temperatureC = [thermalNow.cpuCelsius, thermalNow.batteryCelsius, thermalNow.gpuCelsius].find((value) => isFiniteNumber(value));
			if (isFiniteNumber(temperatureC)) {
				heroChips.push(
					h(
						"span",
						{ className: "dx-chip", key: "temperature" },
						h(Icon, { name: "spark", size: 13 }),
						t("overview.kpi.temp"),
						h("strong", null, fmtNumber(temperatureC, 1) + " °C"),
					),
				);
			}
			if (network.wifi) {
				heroChips.push(
					h("span", { className: "dx-chip", key: "wifi" }, h(Icon, { name: "wifi", size: 13 }), h("strong", null, network.wifi.ssid || t("common.wifi")), h(SignalBars, { level: wifiLevel, label: t("net.signalLevel", { level: wifiLevel }) })),
				);
			} else if (network.defaultInterface) {
				heroChips.push(h("span", { className: "dx-chip", key: "iface" }, h(Icon, { name: "network", size: 13 }), network.defaultInterface, h("strong", null, asArray(network.primaryIpv4)[0] || "")));
			}
			const memorySegments = MEMORY_SEGMENTS.map((segment) => {
				const value = numOr(memory[segment.key + "Bytes"], null);
				return { key: segment.key, label: t(segment.labelKey), color: segment.color, bytes: value, percent: percentOf(value, memory.totalBytes) };
			});
			const memorySegmentsKnown = memorySegments.filter((segment) => segment.percent !== null);
			const memoryKnownPercent = memorySegmentsKnown.reduce((total, segment) => total + segment.percent, 0);
			const topProcesses = asArray(metrics.processes.top).slice(0, 8);
			return h(
				"div",
				{ className: "dx-section" },
				h(
					"section",
					{ className: "dx-heroCard" },
					h(DeviceScene, { animated: props.threeD !== false }),
					h(
						"div",
						{ className: "dx-heroInfo" },
						h("h1", { className: "dx-heroTitle", title: metrics.hostname }, metrics.hostname || t("panel")),
						h("p", { className: "dx-heroSub" }, metrics.osVersion || cpu.model || t("loading.title")),
						h("div", { className: "dx-heroChips" }, heroChips),
					),
				),
				h(Card, {
					title: t("overview.alerts"),
					icon: "warning",
					children:
						alerts.length === 0
							? h(
									"div",
									{ className: "dx-alertList" },
									h("div", { className: "dx-alert", "data-tone": "idle" }, h("span", { className: "dx-alertIcon" }, h(Icon, { name: "check", size: 15 })), h("span", { className: "dx-alertText" }, t("overview.alerts.none"))),
								)
							: h(
									"div",
									{ className: "dx-alertList", role: "list", "aria-label": t("aria.alert") },
									alerts.map((alert) =>
										h(
											"div",
											{ className: "dx-alert", "data-tone": alert.tone, role: "listitem", key: alert.key },
											h("span", { className: "dx-alertIcon" }, h(Icon, { name: alert.icon, size: 15 })),
											h("span", { className: "dx-alertText" }, alert.text),
										),
									),
								),
				}),
				h(
					"div",
					{ className: "dx-kpiGrid" },
					h(KpiCard, {
						label: t("overview.kpi.cpu"),
						value: fmtPercent(cpu.usagePercent),
						sub: t("overview.kpi.cores", { n: numOr(cpu.logicalCores, 0) }) + " · " + t("overview.kpi.load") + " " + fmtNumber(asArray(cpu.loadAvg)[0], 1),
						donut: h(Donut, { value: cpu.usagePercent, color: usageTone(cpu.usagePercent), label: t("overview.sparkline.cpu"), centerText: fmtPercent(cpu.usagePercent) }),
						spark: h(Sparkline, { series: [{ values: sampleList("cpu"), color: "var(--dsw-alias-brand-primary)" }], domainMax: 100, label: t("overview.sparkline.cpu") }),
					}),
					h(KpiCard, {
						label: t("overview.kpi.memory"),
						value: fmtPercent(memoryPercent),
						sub:
							t("overview.kpi.used", { value: fmtBytes(memory.usedBytes) }) +
							" / " +
							fmtBytes(memory.totalBytes) +
							(isFiniteNumber(memory.swapUsedBytes) && memory.swapUsedBytes > 0 ? " · " + t("overview.kpi.swap", { value: fmtBytes(memory.swapUsedBytes) }) : ""),
						donut: h(Donut, { value: memoryPercent, color: memory.pressure === "normal" ? usageTone(memoryPercent) : pressureTone(memory.pressure), label: t("overview.kpi.memory"), centerText: fmtPercent(memoryPercent) }),
						spark: h(Sparkline, { series: [{ values: sampleList("memory"), color: "var(--dsw-alias-state-warn-primary)" }], domainMax: 100, label: t("overview.sparkline.memory") }),
					}),
					h(KpiCard, {
						label: t("overview.kpi.disk"),
						value: fmtPercent(diskPercent),
						sub: t("overview.kpi.free", { value: fmtBytes(disk.freeBytes) }),
						donut: h(Donut, { value: diskPercent, color: usageTone(diskPercent), label: t("overview.kpi.disk"), centerText: fmtPercent(diskPercent) }),
						spark: h(Sparkline, { series: [{ values: sampleList("disk"), color: "var(--dsw-alias-state-idle-primary)" }], domainMax: 100, label: t("overview.kpi.disk") }),
					}),
					h(KpiCard, {
						label: t("overview.kpi.battery"),
						value: battery && battery.present ? fmtPercent(battery.percent) : t("common.na"),
						sub: batterySub,
						donut: h(Donut, {
							value: battery && battery.present ? battery.percent : null,
							color: batteryTone,
							label: t("overview.kpi.battery"),
							centerText: battery && battery.present ? fmtPercent(battery.percent) : t("common.na"),
						}),
						spark: h(Sparkline, { series: [{ values: sampleList("battery"), color: "var(--dsw-alias-state-success-primary)" }], domainMax: 100, label: t("overview.kpi.battery") }),
					}),
					h(KpiCard, {
						label: t("overview.kpi.network"),
						value: network.wifi ? network.wifi.ssid || t("common.wifi") : network.defaultInterface || t("common.na"),
						sub: t("overview.kpi.rx", { value: fmtRate(network.rxBytesPerSec) }) + " · " + t("overview.kpi.tx", { value: fmtRate(network.txBytesPerSec) }),
						donut: h(Donut, {
							value: wifiQuality,
							color: network.wifi ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-idle-primary)",
							label: t("aria.wifiBars"),
							centerText: network.wifi ? h(SignalBars, { level: wifiLevel, label: t("net.signalLevel", { level: wifiLevel }) }) : h(Icon, { name: "network", size: 17 }),
						}),
						spark: h(Sparkline, {
							series: [
								{ values: sampleList("rx"), color: "var(--dsw-alias-state-success-primary)" },
								{ values: sampleList("tx"), color: "var(--dsw-alias-brand-primary)" },
							],
							label: t("overview.sparkline.network"),
						}),
					}),
				),
				h(
					"div",
					{ className: "dx-grid2" },
					h(Card, {
						title: t("overview.top"),
						icon: "processes",
						actions: props.onShowProcesses
							? h("button", { type: "button", className: "dx-linkBtn", onClick: props.onShowProcesses }, t("tab.processes"), h(Icon, { name: "chevron", size: 12 }))
							: null,
						children:
							topProcesses.length === 0
								? h(EmptyState, { title: t("overview.top.empty") })
								: h(
										"div",
										{ className: "dx-list" },
										topProcesses.map((process, index) =>
											h(
												"div",
												{ className: "dx-listRow", key: process.pid + "-" + index },
												h("span", { className: "dx-listRank" }, String(index + 1)),
												h(
													"div",
													{ className: "dx-grow" },
													h("div", { className: "dx-listPrimary" }, process.name),
													h("div", { className: "dx-listSecondary" }, (process.user || t("common.unknown")) + " · PID " + process.pid),
												),
												h("div", { className: "dx-listRight" }, h("span", { title: t("common.cpu") }, fmtPercent(process.cpu, 1)), h("span", { title: t("common.memory") }, fmtPercent(process.memPercent, 1))),
											),
										),
									),
					}),
					h(Card, {
						title: t("overview.memoryBreakdown"),
						icon: "memory",
						subtitle: fmtBytes(memory.totalBytes),
						children: h(
							"div",
							null,
							h(
								"div",
								{ className: "dx-stackBar", role: "img", "aria-label": t("overview.memoryBreakdown") },
								memorySegmentsKnown.map((segment) =>
									h("span", { key: segment.key, className: "dx-stackSeg", style: { width: (memoryKnownPercent > 0 ? segment.percent : 0) + "%", background: segment.color } }),
								),
							),
							h(
								"div",
								{ className: "dx-legend" },
								memorySegments.map((segment) =>
									h(
										"div",
										{ className: "dx-legendRow", key: segment.key },
										h("span", { className: "dx-legendDot", style: { background: segment.color } }),
										h("span", { className: "dx-legendLabel" }, segment.label),
										h("span", { className: "dx-legendValue" }, segment.bytes === null ? "—" : fmtBytes(segment.bytes)),
									),
								),
							),
						),
					}),
				),
			);
		}

		// ------------------------------------------------------------------
		// Shared tab shell: loading skeleton, section-level error with retry,
		// non-fatal `errors[]` note, then the body.
		// ------------------------------------------------------------------
		function TabShell(props) {
			const t = props.t;
			const state = asObject(props.state);
			const status = strOr(state.status, "idle");
			if (status === "idle" || (status === "loading" && !state.data)) {
				return h(
					Fragment,
					null,
					h(Skeleton, { cards: numOr(props.skeletonCards, 3) }),
					h("p", { className: "dx-loadingHint", role: "status" }, t("loading.sectionHint")),
				);
			}
			if (status === "error" && !state.data) {
				const detail = safeErrorText(state.error);
				return h(ErrorState, {
					t,
					title: props.errorTitle || t("error.section"),
					text: (props.errorText ? props.errorText + " " : "") + t("error.sectionHint") + (detail ? " (" + detail + ")" : ""),
					onRetry: props.onRetry,
					retryLabel: t("common.retry"),
				});
			}
			if (!isObj(state.data)) return h(EmptyState, { title: t("common.empty"), text: t("error.sectionHint"), action: props.onRetry ? h("button", { type: "button", className: "dx-btn", onClick: props.onRetry }, t("common.retry")) : null });
			return h(Fragment, null, h(SectionErrors, { t, section: state.data, labelKey: props.errorsKey }), props.children(state.data));
		}

		function SectionErrors(props) {
			const t = props.t;
			const errors = errorsOf(props.section);
			if (errors.length === 0) return null;
			return h(
				"div",
				{ className: "dx-banner", "data-tone": "warn", role: "status" },
				h("span", { className: "dx-bannerIcon" }, h(Icon, { name: "info", size: 14 })),
				h("span", { className: "dx-bannerText" }, props.labelKey ? t(props.labelKey) : t("error.sectionHint")),
				h("span", { className: "dx-small dx-muted", title: errors.join("\n") }, errors[0]),
			);
		}

		// ------------------------------------------------------------------
		// Hardware
		// ------------------------------------------------------------------
		function HardwareTab(props) {
			const t = props.t;
			const metrics = props.metrics;
			const perCore = metrics ? asArray(metrics.cpu.perCore) : [];
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 4,
				onRetry: props.onRetry,
				errorsKey: "hw.errors",
				children: (data) => {
					const cpu = asObject(data.cpu);
					const memory = asObject(data.memory);
					const storage = asObject(data.storage);
					const battery = isObj(data.battery) ? data.battery : null;
					const bluetooth = asObject(data.bluetooth);
					const controller = asObject(bluetooth.controller);
					const features = asArray(cpu.features).filter((feature) => typeof feature === "string");
					const modules = asArray(memory.modules).filter(isObj);
					const gpus = asArray(data.gpu).filter(isObj);
					const displays = asArray(data.displays).filter(isObj);
					const drives = asArray(storage.physical).filter(isObj);
					const volumes = asArray(storage.volumes).filter(isObj);
					const usbDevices = asArray(data.usb).filter(isObj);
					const btDevices = asArray(bluetooth.devices).filter(isObj);
					const audioDevices = asArray(data.audio).filter(isObj);
					const cameras = asArray(data.cameras).filter(isObj);
					const drivers = asArray(data.drivers).filter(isObj);
					const driverSummary = asObject(data.driverSummary);
					const driverProblems = asArray(data.driverProblems).filter(isObj);
					return h(
						"div",
						{ className: "dx-section" },
						h(
							"div",
							{ className: "dx-grid" },
							h(Card, {
								title: t("hw.cpu"),
								icon: "cpu",
								subtitle: strOr(cpu.model, ""),
								span: 2,
								children: h(
									Fragment,
									null,
									h(FactGrid, {
										t,
										items: [
											cpu.model ? { key: "model", label: t("common.model"), value: cpu.model } : null,
											cpu.vendor ? { key: "vendor", label: t("hw.vendor"), value: cpu.vendor } : null,
											cpu.architecture ? { key: "arch", label: t("hw.arch"), value: cpu.architecture } : null,
											cpu.physicalCores !== null && cpu.physicalCores !== undefined ? { key: "physical", label: t("hw.physical"), value: String(cpu.physicalCores) } : null,
											cpu.logicalCores !== null && cpu.logicalCores !== undefined ? { key: "logical", label: t("hw.logical"), value: String(cpu.logicalCores) } : null,
											isFiniteNumber(cpu.speedGHz) ? { key: "speed", label: t("hw.speed"), value: fmtNumber(cpu.speedGHz, 2) + " GHz" } : null,
										].filter(Boolean),
										emptyText: t("hw.errors"),
									}),
									features.length > 0 ? h("div", { className: "dx-tagList", style: { marginTop: "12px" } }, features.slice(0, 12).map((feature) => h(Pill, { key: feature, tone: "idle" }, feature))) : null,
									perCore.length > 0
										? h(
												"div",
												{ style: { marginTop: "14px" } },
												h("div", { className: "dx-factLabel", style: { marginBottom: "7px" } }, t("hw.cpuCore")),
												h(
													"div",
													{ className: "dx-bars" },
													perCore.map((value, index) => h(Bar, { key: index, label: "#" + (index + 1), percent: value })),
												),
											)
										: null,
								),
							}),
							h(Card, {
								title: t("hw.memory"),
								icon: "memory",
								subtitle: memory.totalBytes !== null ? fmtBytes(memory.totalBytes) : "",
								children: h(
									Fragment,
									null,
									h(FactGrid, {
										t,
										items: [
											memory.type ? { key: "type", label: t("common.type"), value: memory.type } : null,
											isFiniteNumber(memory.speedMHz) ? { key: "speed", label: t("hw.speed"), value: fmtNumber(memory.speedMHz) + " MHz" } : null,
										].filter(Boolean),
										emptyText: t("common.empty"),
									}),
									modules.length > 0
										? h(
												Fragment,
												null,
												h("div", { className: "dx-factLabel", style: { margin: "12px 0 6px" } }, t("hw.memoryModules")),
												h(DataTable, {
													t,
													columns: [
														{ key: "slot", label: t("hw.slot"), render: (row) => strOr(row.slot, "—") },
														{ key: "size", label: t("common.size"), render: (row) => fmtBytes(row.sizeBytes) },
														{ key: "type", label: t("common.type"), render: (row) => strOr(row.type, "—") },
														{ key: "speed", label: t("hw.speed"), render: (row) => (isFiniteNumber(row.speedMHz) ? fmtNumber(row.speedMHz) + " MHz" : "—") },
														{ key: "manufacturer", label: t("hw.manufacturer"), render: (row) => strOr(row.manufacturer, "—") },
														{ key: "part", label: t("hw.partNumber"), render: (row) => strOr(row.partNumber, "—") },
													],
													rows: modules,
												}),
											)
										: h("p", { className: "dx-small dx-muted", style: { marginTop: "10px" } }, t("hw.noModules")),
								),
							}),
							h(Card, {
								title: t("hw.gpu"),
								icon: "gpu",
								children:
									gpus.length === 0
										? h(EmptyState, { title: t("hw.empty") })
										: h(
												"div",
												{ className: "dx-sublist" },
												gpus.map((gpu, index) =>
													h(SubCard, {
														key: index,
														title: strOr(gpu.name, "—"),
														icon: "gpu",
														meta: [
															isFiniteNumber(gpu.cores) ? t("hw.gpuCores", { n: gpu.cores }) : null,
															gpu.vramBytes !== null && gpu.vramBytes !== undefined ? t("hw.vram") + " " + fmtBytes(gpu.vramBytes) : null,
															gpu.vendor ? gpu.vendor : null,
															gpu.metal ? t("hw.metal") : null,
														]
															.filter(Boolean)
															.join(" · "),
													}),
												),
											),
							}),
							h(Card, {
								title: t("hw.displays"),
								icon: "display",
								children:
									displays.length === 0
										? h(EmptyState, { title: t("hw.empty") })
										: h(
												"div",
												{ className: "dx-sublist" },
												displays.map((display, index) =>
													h(SubCard, {
														key: index,
														title: strOr(display.name, "—"),
														icon: "display",
														badge: display.main === true ? h(Pill, { tone: "brand" }, t("hw.main")) : null,
														meta: [
															display.resolution ? display.resolution : null,
															isFiniteNumber(display.refreshHz) ? fmtNumber(display.refreshHz) + " Hz" : null,
															display.connection ? display.connection : null,
														]
															.filter(Boolean)
															.join(" · "),
													}),
												),
											),
							}),
							h(Card, {
								title: t("hw.storage"),
								icon: "disk",
								subtitle: drives.length > 0 || volumes.length > 0 ? "" : "",
								span: 2,
								children: h(
									Fragment,
									null,
									drives.length > 0
										? h(
												Fragment,
												null,
												h("div", { className: "dx-factLabel", style: { marginBottom: "6px" } }, t("hw.drives")),
												h(DataTable, {
													t,
													columns: [
														{ key: "name", label: t("common.name"), render: (row) => strOr(row.name, strOr(row.model, "—")) },
														{ key: "model", label: t("common.model"), render: (row) => strOr(row.model, "—") },
														{ key: "size", label: t("common.size"), render: (row) => fmtBytes(row.sizeBytes) },
														{ key: "media", label: t("hw.mediaType"), render: (row) => strOr(row.mediaType, "—") },
														{ key: "smart", label: t("hw.smart"), render: (row) => strOr(row.smartStatus, "—") },
													],
													rows: drives,
												}),
											)
										: null,
									volumes.length > 0
										? h(
												"div",
												{ style: { marginTop: drives.length > 0 ? "16px" : "0" } },
												h("div", { className: "dx-factLabel", style: { marginBottom: "8px" } }, t("hw.volumes")),
												h(
													"div",
													{ className: "dx-sublist" },
													volumes.map((volume, index) => {
														const percent = percentOf(volume.usedBytes, volume.totalBytes);
														return h(
															"div",
															{ key: index, className: "dx-subcard" },
															h(
																"div",
																{ className: "dx-subcardHead" },
																h("span", { className: "dx-subcardTitle" }, strOr(volume.name, strOr(volume.mount, "—"))),
																volume.internal === false ? h(Pill, { tone: "idle" }, t("hw.removable")) : null,
							),
															h(
																"div",
																{ className: "dx-subcardMeta" },
																strOr(volume.mount, "—") + " · " + strOr(volume.fs, "—") + " · " + fmtBytes(volume.usedBytes) + " / " + fmtBytes(volume.totalBytes),
															),
															h(
																"div",
																{ className: "dx-barTrack", style: { marginTop: "8px" }, role: "presentation" },
																h("div", { className: "dx-barFill", style: { width: (percent === null ? 0 : percent) + "%", background: usageTone(percent) } }),
															),
														);
													}),
												),
											)
										: h(EmptyState, { title: t("common.empty") }),
								),
							}),
							h(Card, {
								title: t("hw.battery"),
								icon: "battery",
								children: battery
									? h(
											Fragment,
											null,
											h(FactGrid, {
												t,
												items: [
													battery.condition ? { key: "condition", label: t("hw.condition"), value: battery.condition } : null,
													battery.percent !== null && battery.percent !== undefined ? { key: "percent", label: t("common.battery"), value: t("hw.batteryPercent", { percent: fmtPercent(battery.percent) }) } : null,
													battery.healthPercent !== null && battery.healthPercent !== undefined ? { key: "health", label: t("hw.health"), value: fmtPercent(battery.healthPercent) } : null,
													battery.cycleCount !== null && battery.cycleCount !== undefined ? { key: "cycles", label: t("hw.cycles"), value: String(battery.cycleCount) } : null,
													battery.designCapacityMah !== null && battery.designCapacityMah !== undefined ? { key: "design", label: t("hw.designCapacity"), value: String(battery.designCapacityMah) + " mAh" } : null,
													battery.maxCapacityMah !== null && battery.maxCapacityMah !== undefined ? { key: "max", label: t("hw.maxCapacity"), value: String(battery.maxCapacityMah) + " mAh" } : null,
													battery.temperatureC !== null && battery.temperatureC !== undefined ? { key: "temperature", label: t("common.temperature"), value: fmtNumber(battery.temperatureC, 1) + " °C" } : null,
												].filter(Boolean),
												emptyText: t("hw.batteryNoData"),
											}),
										)
									: h(EmptyState, { icon: "battery", title: t("hw.batteryNoData") }),
							}),
							h(ThermalCard, { t, thermal: metrics ? metrics.thermal : null }),
							h(DriversCard, { t, drivers, summary: driverSummary, problems: driverProblems }),
							h(Card, {
								title: t("hw.usb"),
								icon: "usb",
								children:
									usbDevices.length === 0
										? h(EmptyState, { title: t("hw.empty") })
										: h(DataTable, {
												t,
												columns: [
													{ key: "name", label: t("common.name"), render: (row) => strOr(row.name, "—") },
													{ key: "vendor", label: t("hw.vendor"), render: (row) => strOr(row.vendor, "—") },
													{ key: "serial", label: t("common.serial"), render: (row) => strOr(row.serial, "—") },
													{ key: "speed", label: t("hw.usbSpeed"), render: (row) => (row.speed === null || row.speed === undefined ? "—" : String(row.speed)) },
													{ key: "bus", label: t("hw.bus"), render: (row) => (row.bus === null || row.bus === undefined ? "—" : String(row.bus)) },
												],
												rows: usbDevices,
											}),
							}),
							h(Card, {
								title: t("hw.bluetooth"),
								icon: "bluetooth",
								children: h(
									Fragment,
									null,
									Object.keys(controller).length > 0
										? h(FactGrid, {
												t,
												items: [
													controller.address ? { key: "address", label: t("common.address"), value: controller.address } : null,
													controller.chipset ? { key: "chipset", label: t("hw.chipset"), value: controller.chipset } : null,
													controller.firmware ? { key: "firmware", label: t("hw.firmware"), value: controller.firmware } : null,
													controller.state ? { key: "state", label: t("common.state"), value: controller.state } : null,
												].filter(Boolean),
												emptyText: t("common.empty"),
											})
										: null,
									btDevices.length > 0
										? h(
												"div",
												{ style: { marginTop: Object.keys(controller).length > 0 ? "12px" : "0" } },
												h(DataTable, {
													t,
													columns: [
														{ key: "name", label: t("common.name"), render: (row) => strOr(row.name, "—") },
														{ key: "address", label: t("common.address"), render: (row) => strOr(row.address, "—") },
														{
															key: "connected",
															label: t("common.status"),
															render: (row) => (row.connected === true ? h(Pill, { tone: "ok" }, t("hw.connected")) : h(Pill, { tone: "idle" }, t("hw.notConnected"))),
														},
														{ key: "battery", label: t("common.battery"), render: (row) => (row.batteryPercent === null || row.batteryPercent === undefined ? "—" : fmtPercent(row.batteryPercent)) },
													],
													rows: btDevices,
												}),
											)
										: h("p", { className: "dx-small dx-muted", style: { marginTop: "10px" } }, t("hw.empty")),
								),
							}),
							h(Card, {
								title: t("hw.audio"),
								icon: "audio",
								children:
									audioDevices.length === 0
										? h(EmptyState, { title: t("hw.empty") })
										: h(
												"div",
												{ className: "dx-sublist" },
												audioDevices.map((device, index) =>
													h(SubCard, {
														key: index,
														title: strOr(device.name, "—"),
														icon: "audio",
														badge: device.default === true ? h(Pill, { tone: "brand" }, t("hw.default")) : device.kind === "input" ? h(Pill, { tone: "idle" }, t("hw.input")) : h(Pill, { tone: "idle" }, t("hw.output")),
														meta: strOr(device.manufacturer, ""),
													}),
												),
											),
							}),
							h(Card, {
								title: t("hw.cameras"),
								icon: "camera",
								children:
									cameras.length === 0
										? h(EmptyState, { title: t("hw.empty") })
										: h(DataTable, {
												t,
												columns: [
													{ key: "name", label: t("common.name"), render: (row) => strOr(row.name, "—") },
													{ key: "modelId", label: t("hw.modelId"), render: (row) => strOr(row.modelId, "—") },
													{ key: "uniqueId", label: t("hw.uniqueId"), render: (row) => strOr(row.uniqueId, "—") },
												],
												rows: cameras,
											}),
							}),
						),
					);
				},
			});
		}

		// ------------------------------------------------------------------
		// System
		// ------------------------------------------------------------------
		const ENV_KEYS = ["PATH", "SHELL", "HOME", "USER", "LANG", "TERM"];
		const AGENT_SCOPE_KEYS = { user: "sys.userScope", system: "sys.systemScope" };

		function SystemTab(props) {
			const t = props.t;
			const isWindows = props.platform === "win32";
			const pending = asObject(props.pending);
			const agentPending = pending["system.launchAgent"] === true;
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 4,
				onRetry: props.onRetry,
				errorsKey: "sys.errors",
				children: (data) => {
					const os = asObject(data.os);
					const device = asObject(data.device);
					const boot = asObject(data.boot);
					const currentUser = asObject(data.user);
					const users = asArray(data.users).filter(isObj);
					const launchAgents = asArray(data.launchAgents).filter(isObj);
					const loginItems = asArray(data.loginItems).filter(isObj);
					const environment = asObject(data.environment);
					const locale = asObject(data.locale);
					const facts = [
						os.name || os.version ? { key: "name", label: t("sys.name"), value: strOr(os.name, "—") + (os.version ? " " + os.version : "") } : null,
						os.build ? { key: "build", label: t("sys.build"), value: os.build } : null,
						os.kernel ? { key: "kernel", label: t("sys.kernel"), value: os.kernel } : null,
						os.arch ? { key: "arch", label: t("sys.arch"), value: os.arch } : null,
					].filter(Boolean);
					const deviceFacts = [
						device.hostname ? { key: "hostname", label: t("sys.hostname"), value: device.hostname } : null,
						device.computerName ? { key: "computerName", label: t("sys.computerName"), value: device.computerName } : null,
						device.localHostname ? { key: "localHostname", label: t("sys.localHostname"), value: device.localHostname } : null,
						device.model ? { key: "model", label: t("sys.model"), value: device.model } : null,
						device.modelId ? { key: "modelId", label: t("sys.modelId"), value: device.modelId } : null,
						device.chip ? { key: "chip", label: t("sys.chip"), value: device.chip } : null,
						device.serial ? { key: "serial", label: t("sys.serial"), value: device.serial } : null,
						device.hardwareUuid ? { key: "uuid", label: t("sys.hardwareUuid"), value: device.hardwareUuid } : null,
					].filter(Boolean);
					const bootFacts = [
						isFiniteNumber(boot.bootTime) ? { key: "bootTime", label: t("sys.bootTime"), value: fmtDateTime(boot.bootTime) } : null,
						boot.uptimeSec !== null && boot.uptimeSec !== undefined ? { key: "uptime", label: t("sys.uptime"), value: fmtUptime(boot.uptimeSec, t) } : null,
					].filter(Boolean);
					const userFacts = [
						currentUser.name ? { key: "name", label: t("sys.currentUser"), value: currentUser.name } : null,
						currentUser.fullName ? { key: "fullName", label: t("sys.fullName"), value: currentUser.fullName } : null,
						currentUser.shell ? { key: "shell", label: t("sys.shell"), value: currentUser.shell } : null,
						currentUser.home ? { key: "home", label: t("sys.home"), value: currentUser.home } : null,
						currentUser.uid !== null && currentUser.uid !== undefined ? { key: "uid", label: t("sys.uid"), value: String(currentUser.uid) } : null,
					].filter(Boolean);
					const localeFacts = [
						locale.timezone ? { key: "timezone", label: t("sys.timezone"), value: locale.timezone } : null,
						locale.language ? { key: "language", label: t("sys.language"), value: locale.language } : null,
						locale.locale ? { key: "locale", label: t("sys.localeValue"), value: locale.locale } : null,
						isFiniteNumber(currentUser.uid) ? { key: "uid", label: t("sys.uid"), value: String(currentUser.uid) } : null,
					].filter(Boolean);
					const envRows = ENV_KEYS.filter((key) => typeof environment[key] === "string" && environment[key].length > 0).map((key) => ({ key, value: environment[key] }));
					const agentRows = launchAgents.slice(0, 200);
					return h(
						"div",
						{ className: "dx-section" },
						h(
							"div",
							{ className: "dx-grid2" },
							h(Card, { title: t("sys.os"), icon: "system", children: h(FactGrid, { t, items: facts, emptyText: t("common.empty") }) }),
							h(Card, { title: t("sys.device"), icon: "cpu", children: h(FactGrid, { t, items: deviceFacts, emptyText: t("common.empty") }) }),
							h(Card, { title: t("sys.boot"), icon: "boot", children: h(FactGrid, { t, items: bootFacts, emptyText: t("common.empty") }) }),
							h(Card, { title: t("sys.locale"), icon: "locale", children: h(FactGrid, { t, items: localeFacts, emptyText: t("common.empty") }) }),
						),
						h(Card, {
							title: t("sys.users"),
							icon: "users",
							subtitle: currentUser.admin === true ? t("sys.currentUser") + " · " + t("common.admin") : t("sys.currentUser") + " · " + strOr(currentUser.name, "—"),
							flush: true,
							children: h(DataTable, {
								t,
								ariaLabel: t("sys.users"),
								columns: [
									{ key: "name", label: t("common.user"), render: (row) => strOr(row.name, "—") },
									{ key: "fullName", label: t("sys.fullName"), render: (row) => strOr(row.fullName, "—") },
									{ key: "uid", label: t("sys.uid"), render: (row) => (row.uid === null || row.uid === undefined ? "—" : String(row.uid)) },
									{ key: "gid", label: t("sys.gid"), render: (row) => (row.gid === null || row.gid === undefined ? "—" : String(row.gid)) },
									{
										key: "admin",
										label: t("common.admin"),
										render: (row) => (row.admin === true ? h(Pill, { tone: "brand" }, t("common.admin")) : h("span", { className: "dx-muted" }, "—")),
									},
									{
										key: "current",
										label: t("common.current"),
										render: (row) => (row.isCurrent === true ? h(Pill, { tone: "ok" }, t("common.current")) : h("span", { className: "dx-muted" }, "—")),
									},
								],
								rows: users,
								empty: h(EmptyState, { title: t("common.empty") }),
							}),
						}),
						h(Card, {
							title: isWindows ? t("sys.startupItems") : t("sys.launchAgents"),
							icon: "agent",
							subtitle: String(launchAgents.length),
							flush: true,
							actions: agentPending ? h("span", { className: "dx-pill", "data-tone": "brand" }, t("common.pending")) : null,
							children: h(DataTable, {
								t,
								ariaLabel: isWindows ? t("sys.startupItems") : t("sys.launchAgents"),
								columns: [
									{ key: "label", label: t("common.name"), render: (row) => strOr(row.label, "—") },
									{
										key: "scope",
										label: t("sys.scope"),
										render: (row) => {
											const scopeKey = AGENT_SCOPE_KEYS[strOr(row.scope, "")];
											return h(Pill, { tone: row.scope === "system" ? "warn" : "idle" }, scopeKey ? t(scopeKey) : strOr(row.scope, "—"));
										},
									},
									{
										key: "loaded",
										label: t("sys.loaded"),
										render: (row) =>
											typeof row.path === "string" && row.path.length > 0
												? h(
														"span",
														{ style: { display: "inline-flex", alignItems: "center", gap: "8px" } },
														h(Switch, {
															checked: row.loaded === true,
															disabled: agentPending,
															label: strOr(row.label, t("sys.launchAgents")),
															onChange: () =>
																props.openConfirm({
																	title: t(row.loaded === true ? "sys.agentConfirmDisable" : "sys.agentConfirmEnable", { label: strOr(row.label, "—") }),
																	confirmLabel: t(row.loaded === true ? "sys.disableAgent" : "sys.enableAgent"),
																	danger: false,
																	actionId: "system.launchAgent",
																	params: { path: row.path, enabled: row.loaded !== true },
																}),
														}),
														h("span", { className: "dx-muted dx-small" }, row.loaded === true ? t("common.enabled") : t("common.disabled")),
													)
												: h("span", { className: "dx-muted" }, "—"),
									},
									{ key: "pid", label: t("common.pid"), render: (row) => (row.pid === null || row.pid === undefined ? "—" : String(row.pid)) },
									{ key: "exit", label: t("sys.lastExit"), render: (row) => (row.lastExitStatus === null || row.lastExitStatus === undefined ? "—" : String(row.lastExitStatus)) },
									{ key: "program", label: t("sys.program"), render: (row) => strOr(row.program, "—") },
								],
								rows: agentRows,
								empty: h(EmptyState, { title: t("sys.noAgents") }),
							}),
						}),
						h(
							"div",
							{ className: "dx-grid2" },
							h(Card, {
								title: t("sys.loginItems"),
								icon: "boot",
								children:
									loginItems.length === 0
										? h(EmptyState, { title: t("sys.noLoginItems") })
										: h(
												"div",
												{ className: "dx-tagList" },
												loginItems.slice(0, 40).map((item, index) => h(Pill, { key: index, tone: "idle" }, strOr(item.name, "—"))),
											),
							}),
							h(Card, {
								title: t("sys.environment"),
								icon: "env",
								subtitle: t("sys.envNote"),
								flush: true,
								children: h(DataTable, {
									t,
									columns: [
										{ key: "key", label: t("common.name"), render: (row) => h("span", { className: "dx-mono" }, row.key) },
										{ key: "value", label: t("common.value"), cellClass: "dx-tdWrap", render: (row) => h("span", { className: "dx-mono", title: row.value }, row.value) },
									],
									rows: envRows,
									empty: h(EmptyState, { title: t("common.empty") }),
								}),
							}),
						),
					);
				},
			});
		}

		// ------------------------------------------------------------------
		// Software
		// ------------------------------------------------------------------
		const SW_SOURCE_KEYS = { system: "sw.source.system", user: "sw.source.user", other: "sw.source.other" };

		function SoftwareTab(props) {
			const t = props.t;
			const pending = asObject(props.pending);
			const [search, setSearch] = useState("");
			const [sourceFilter, setSourceFilter] = useState("all");
			const [sortDirection, setSortDirection] = useState("asc");
			const sourceOptions = [
				{ value: "all", label: t("common.all") },
				{ value: "system", label: t("sw.source.system") },
				{ value: "user", label: t("sw.source.user") },
				{ value: "other", label: t("sw.source.other") },
			];
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 3,
				onRetry: props.onRetry,
				errorsKey: "sw.errors",
				children: (data) => {
					const homebrew = asObject(data.homebrew);
					const winget = asObject(data.winget);
					const isWindows = props.platform === "win32";
					const applications = asArray(data.applications).filter(isObj);
					const query = search.trim().toLowerCase();
					const filtered = applications
						.filter((application) => {
							const name = strOr(application.name, "").toLowerCase();
							const bundleId = strOr(application.bundleId, "").toLowerCase();
							const matchesQuery = query.length === 0 || name.indexOf(query) >= 0 || bundleId.indexOf(query) >= 0;
							const source = strOr(application.source, "other");
							const matchesSource = sourceFilter === "all" || source === sourceFilter;
							return matchesQuery && matchesSource;
						})
						.sort((left, right) => {
							const first = strOr(left.name, "").toLowerCase();
							const second = strOr(right.name, "").toLowerCase();
							return sortDirection === "asc" ? first.localeCompare(second) : second.localeCompare(first);
						});
					const installed = asArray(homebrew.installed).filter(isObj);
					const outdated = asArray(homebrew.outdated);
					return h(
						"div",
						{ className: "dx-section" },
						h(Card, {
							title: t("sw.applications"),
							icon: "software",
							subtitle: t("sw.appCount", { n: numOr(data.totalApplications, applications.length) }),
							actions: h(SegmentedControl, { label: t("sw.sourceFilter"), options: sourceOptions, value: sourceFilter, onChange: setSourceFilter }),
							flush: true,
							children: h(
								Fragment,
								null,
								h(
									"div",
									{ className: "dx-toolbar", style: { padding: "12px 16px" } },
									h("div", { className: "dx-toolbarLeft" }, h(SearchField, { value: search, onChange: setSearch, placeholder: t("sw.search"), label: t("common.search") })),
									h(
										"div",
										{ className: "dx-toolbarRight" },
										h("span", { className: "dx-small dx-muted" }, installed.length > 0 ? String(installed.length) + " / " + String(applications.length) : String(applications.length)),
										h(
											"button",
											{
												type: "button",
												className: "dx-btn",
												"data-size": "sm",
												onClick: () => setSortDirection(sortDirection === "asc" ? "desc" : "asc"),
												title: sortDirection === "asc" ? t("sw.sortAsc") : t("sw.sortDesc"),
												"aria-label": t("sw.sortName"),
											},
											h(Icon, { name: sortDirection === "asc" ? "arrowUp" : "arrowDown", size: 13 }),
											sortDirection === "asc" ? t("sw.sortAsc") : t("sw.sortDesc"),
										),
									),
								),
								h(DataTable, {
									t,
									ariaLabel: t("sw.applications"),
									columns: [
										{
											key: "name",
											label: t("common.name"),
											render: (row) =>
												h(
													"div",
													{ style: { minWidth: 0 } },
													h("div", { style: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" } }, strOr(row.name, "—")),
													row.bundleId ? h("div", { className: "dx-small dx-muted" }, row.bundleId) : null,
												),
										},
										{ key: "version", label: t("common.version"), render: (row) => strOr(row.version, "—") },
										{
											key: "source",
											label: t("common.source"),
											render: (row) => {
												const source = strOr(row.source, "other");
												const key = SW_SOURCE_KEYS[source];
												return h(Pill, { tone: source === "user" ? "brand" : "idle" }, key ? t(key) : source);
											},
										},
										{ key: "arch", label: t("sw.arch"), render: (row) => strOr(row.arch, "—") },
										{ key: "size", label: t("sw.size"), render: (row) => fmtBytes(row.sizeBytes) },
										{ key: "lastUsed", label: t("sw.lastUsed"), render: (row) => (isFiniteNumber(row.lastUsed) && row.lastUsed > 0 ? fmtDateTime(row.lastUsed) : t("common.never")) },
										{
											key: "actions",
											label: t("common.actions"),
											align: "right",
											render: (row) => {
												const path = strOr(row.path, "");
												const uninstallId = strOr(row.uninstallId, "");
												const isSystemApp = strOr(row.source, "") === "system" || path.indexOf("/System/") === 0;
												const canUninstall = isWindows ? uninstallId.length > 0 || (path.length > 0 && !isSystemApp) : path.length > 0 && !isSystemApp;
												return h(
													"div",
													{ className: "dx-rowActions" },
													h(
														"button",
														{
															type: "button",
															className: "dx-btn",
															"data-size": "sm",
															disabled: !path || pending["app.reveal"] === true,
															title: isWindows ? t("sw.revealWin") : t("sw.reveal"),
															"aria-label": (isWindows ? t("sw.revealWin") : t("sw.reveal")) + " " + strOr(row.name, ""),
															onClick: () => props.onAction("app.reveal", { path }),
														},
														h(Icon, { name: "reveal", size: 13 }),
													),
													h(
														"button",
														{
															type: "button",
															className: "dx-btn",
															"data-size": "sm",
															"data-variant": "danger",
															disabled: !canUninstall || pending["app.uninstall"] === true,
															title: isSystemApp ? t("sw.systemAppNote") : t("sw.uninstall"),
															"aria-label": t("sw.uninstall") + " " + strOr(row.name, ""),
															onClick: () =>
																props.openConfirm({
																	title: t("sw.uninstallTitle", { name: strOr(row.name, "—") }),
																	description: uninstallId.length > 0 ? t("sw.uninstallBodyWin") : t("sw.uninstallBody"),
																	confirmLabel: t("sw.uninstall"),
																	danger: true,
																	actionId: "app.uninstall",
																	params: { path, id: uninstallId, mode: "trash" },
																}),
														},
														h(Icon, { name: "trash", size: 13 }),
													),
												);
											},
										},
									],
									rows: filtered,
									empty: h(EmptyState, { icon: "software", title: t("sw.noApps"), text: applications.length === 0 ? t("sw.loadingApps") : undefined }),
								}),
							),
						}),
						h(Card, {
							title: isWindows ? t("sw.winget") : t("sw.homebrew"),
							icon: "database",
							subtitle: isWindows
								? winget.available === true
									? t("sw.wingetAvailable") + (strOr(winget.version, "") ? " · " + strOr(winget.version, "") : "")
									: t("sw.wingetUnavailable")
								: homebrew.available === true
									? strOr(homebrew.prefix, "")
									: t("sw.brewNotAvailable"),
							flush: true,
							children: isWindows
									? h(EmptyState, {
											icon: "database",
											title: winget.available === true ? t("sw.wingetHint") : t("sw.wingetUnavailable"),
										})
									: homebrew.available !== true
										? h(EmptyState, { icon: "database", title: t("sw.brewNotAvailable") })
									: h(DataTable, {
											t,
											ariaLabel: t("sw.homebrew"),
											columns: [
												{ key: "name", label: t("common.name"), render: (row) => h("span", { className: "dx-mono" }, strOr(row.name, "—")) },
												{ key: "version", label: t("common.version"), render: (row) => h("span", { className: "dx-mono" }, strOr(row.version, "—")) },
												{
													key: "actions",
													label: t("common.actions"),
													align: "right",
													render: (row) =>
														h(
															"button",
															{
																type: "button",
																className: "dx-btn",
																"data-size": "sm",
																"data-variant": "danger",
																disabled: pending["software.brewUninstall"] === true,
																onClick: () =>
																	props.openConfirm({
																		title: t("sw.brewConfirmTitle", { name: strOr(row.name, "—") }),
																		description: t("sw.brewConfirmBody", { name: strOr(row.name, "—") }),
																		confirmLabel: t("sw.brewUninstall"),
																		danger: true,
																		actionId: "software.brewUninstall",
																		params: { name: strOr(row.name, "") },
																	}),
															},
															t("sw.brewUninstall"),
														),
												},
											],
											rows: installed,
											empty: h(EmptyState, { icon: "database", title: t("sw.noBrew") }),
										}),
						}),
						!isWindows && outdated.length > 0
							? h(
									"div",
									{ className: "dx-banner", "data-tone": "warn" },
									spanIcon("warning"),
									h("span", { className: "dx-bannerText" }, t("sw.brewOutdated") + ": " + outdated.map((entry) => (typeof entry === "string" ? entry : strOr(asObject(entry).name, ""))).filter(Boolean).join(", ")),
								)
							: null,
					);
				},
			});
		}

		/** Tiny helper for banner icons. */
		function spanIcon(name) {
			return h("span", { className: "dx-bannerIcon" }, h(Icon, { name, size: 14 }));
		}

		// ------------------------------------------------------------------
		// Network
		// ------------------------------------------------------------------
		const NET_TYPE_KEYS = { wifi: "net.type.wifi", ethernet: "net.type.ethernet", loopback: "net.type.loopback", bridge: "net.type.bridge", other: "net.type.other" };

		function NetworkTab(props) {
			const t = props.t;
			const pending = asObject(props.pending);
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 4,
				onRetry: props.onRetry,
				errorsKey: "net.errors",
				children: (data) => {
					const interfaces = asArray(data.interfaces).filter(isObj);
					const wifi = isObj(data.wifi) ? data.wifi : null;
					const defaultRoute = isObj(data.defaultRoute) ? data.defaultRoute : null;
					const dns = asObject(data.dns);
					const proxy = asObject(data.proxy);
					const ports = asArray(data.listeningPorts).filter(isObj);
					const wifiInterface = interfaces.find((entry) => entry.type === "wifi");
					const wifiOn = wifiInterface ? wifiInterface.up !== false : wifi !== null;
					const wifiPowerLabel = wifiOn ? t("net.wifiPowerOn") : t("net.wifiPowerOff");
					const serviceName = defaultRoute && defaultRoute.interface ? defaultRoute.interface : "Wi-Fi";
					const dnsServers = asArray(dns.servers).filter((entry) => typeof entry === "string");
					const searchDomains = asArray(dns.searchDomains).filter((entry) => typeof entry === "string");
					const proxyRows = [
						{ key: "http", label: t("net.http") },
						{ key: "https", label: t("net.https") },
						{ key: "socks", label: t("net.socks") },
					];
					return h(
						"div",
						{ className: "dx-section" },
						h(
							"div",
							{ className: "dx-grid2" },
							h(Card, {
								title: t("net.wifi"),
								icon: "wifi",
								actions: h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										"data-size": "sm",
										disabled: pending["network.setWifiPower"] === true,
										onClick: () =>
											props.openConfirm({
												title: wifiOn ? t("net.confirmWifiOff") : t("net.confirmWifiOn"),
												confirmLabel: wifiPowerLabel,
												danger: wifiOn,
												actionId: "network.setWifiPower",
												params: { enabled: !wifiOn },
											}),
									},
									h(Icon, { name: "wifi", size: 13 }),
									wifiPowerLabel,
								),
								children: wifi
									? h(
											Fragment,
											null,
											h(
												"div",
												{ className: "dx-toolbar", style: { gap: "12px", marginBottom: "10px" } },
												h(SignalBars, { level: rssiLevel(wifi.rssi), label: t("net.signalLevel", { level: rssiLevel(wifi.rssi) }) }),
												h("span", { style: { fontWeight: 600 } }, strOr(wifi.ssid, "—")),
												h("span", { className: "dx-small dx-muted" }, isFiniteNumber(wifi.rssi) ? String(Math.round(wifi.rssi)) + " dBm" : ""),
											),
											h(FactGrid, {
												t,
												items: [
													wifi.bssid ? { key: "bssid", label: t("net.bssid"), value: wifi.bssid } : null,
													wifi.channel !== null && wifi.channel !== undefined ? { key: "channel", label: t("net.channel"), value: String(wifi.channel) } : null,
													wifi.security ? { key: "security", label: t("net.security"), value: wifi.security } : null,
													wifi.txRateMbps !== null && wifi.txRateMbps !== undefined ? { key: "txRate", label: t("net.txRate"), value: fmtNumber(wifi.txRateMbps) + " Mbps" } : null,
													wifi.noise !== null && wifi.noise !== undefined ? { key: "noise", label: t("net.noise"), value: String(wifi.noise) + " dBm" } : null,
												].filter(Boolean),
												emptyText: t("common.empty"),
											}),
										)
									: h(EmptyState, { icon: "wifi", title: t("net.notConnected"), text: wifiPowerLabel }),
							}),
							h(Card, {
								title: t("net.dns"),
								icon: "network",
								actions: h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										"data-size": "sm",
										disabled: pending["network.setDns"] === true,
										onClick: () => props.openDns(serviceName, dnsServers),
									},
									h(Icon, { name: "gear", size: 13 }),
									t("net.setDns"),
								),
								children: h(
									Fragment,
									null,
									dnsServers.length === 0
										? h(EmptyState, { icon: "network", title: t("net.none") })
										: h("div", { className: "dx-tagList" }, dnsServers.map((server) => h(Pill, { key: server, tone: "idle" }, h("span", { className: "dx-mono" }, server)))),
									searchDomains.length > 0 ? h("div", { className: "dx-subcardMeta", style: { marginTop: "10px" } }, t("net.searchDomains") + ": " + searchDomains.join(", ")) : null,
								),
							}),
							h(Card, {
								title: t("net.route"),
								icon: "network",
								actions: h(
									"button",
									{ type: "button", className: "dx-btn", "data-size": "sm", onClick: () => props.openPane(["network"], "network") },
									h(Icon, { name: "gear", size: 13 }),
									t("net.openSettings"),
								),
								children: h(FactGrid, {
									t,
									items: [
										defaultRoute && defaultRoute.gateway ? { key: "gateway", label: t("net.gateway"), value: defaultRoute.gateway } : null,
										defaultRoute && defaultRoute.interface ? { key: "interface", label: t("net.interface"), value: defaultRoute.interface } : null,
									].filter(Boolean),
									emptyText: t("net.none"),
								}),
							}),
							h(Card, {
								title: t("net.proxy"),
								icon: "env",
								children: h(FactGrid, {
									t,
									items: proxyRows.map((row) => ({
										key: row.key,
										label: row.label,
										value: proxy[row.key] === null || proxy[row.key] === undefined || proxy[row.key] === "" ? t("net.none") : String(proxy[row.key]),
									})),
								}),
							}),
						),
						h(Card, {
							title: t("net.interfaces"),
							icon: "network",
							flush: true,
							subtitle: String(interfaces.length),
							children: h(DataTable, {
								t,
								ariaLabel: t("net.interfaces"),
								columns: [
									{
										key: "name",
										label: t("net.interface"),
										render: (row) =>
											h(
												"span",
												{ style: { display: "inline-flex", alignItems: "center", gap: "7px" } },
												h("span", { className: "dx-mono" }, strOr(row.name, "—")),
												row.primary === true ? h(Pill, { tone: "brand" }, t("net.primary")) : null,
											),
									},
									{
										key: "type",
										label: t("common.type"),
										render: (row) => {
											const key = NET_TYPE_KEYS[strOr(row.type, "other")];
											return h(Pill, { tone: "idle" }, key ? t(key) : strOr(row.type, "—"));
										},
									},
									{
										key: "up",
										label: t("common.status"),
										render: (row) => (row.up === true ? h(Pill, { tone: "ok" }, t("net.up")) : row.up === false ? h(Pill, { tone: "idle" }, t("net.down")) : h(Pill, { tone: "idle" }, t("common.unknown"))),
									},
									{ key: "ipv4", label: t("net.ipv4"), render: (row) => (asArray(row.ipv4).length > 0 ? asArray(row.ipv4).join(", ") : t("net.ipNone")) },
									{ key: "ipv6", label: t("net.ipv6"), render: (row) => (asArray(row.ipv6).length > 0 ? asArray(row.ipv6).join(", ") : t("net.ipNone")) },
									{ key: "mac", label: t("net.mac"), render: (row) => h("span", { className: "dx-mono" }, strOr(row.mac, "—")) },
									{ key: "mtu", label: t("net.mtu"), render: (row) => (row.mtu === null || row.mtu === undefined ? "—" : String(row.mtu)) },
								],
								rows: interfaces,
								empty: h(EmptyState, { title: t("net.noInterfaces") }),
							}),
						}),
						h(Card, {
							title: t("net.ports"),
							icon: "signal",
							subtitle: t("net.established") + ": " + (data.establishedCount === null || data.establishedCount === undefined ? "—" : t("net.establishedCount", { n: data.establishedCount })),
							flush: true,
							children: h(DataTable, {
								t,
								ariaLabel: t("net.ports"),
								columns: [
									{ key: "proto", label: t("net.proto"), render: (row) => h("span", { className: "dx-mono" }, strOr(row.proto, "—").toUpperCase()) },
									{ key: "address", label: t("common.address"), render: (row) => h("span", { className: "dx-mono" }, strOr(row.address, "—")) },
									{ key: "port", label: t("common.port"), render: (row) => h("span", { className: "dx-mono" }, row.port === null || row.port === undefined ? "—" : String(row.port)) },
									{ key: "pid", label: t("common.pid"), render: (row) => (row.pid === null || row.pid === undefined ? "—" : String(row.pid)) },
									{ key: "process", label: t("common.process"), render: (row) => strOr(row.process, "—") },
								],
								rows: ports,
								empty: h(EmptyState, { title: t("net.noPorts") }),
							}),
						}),
					);
				},
			});
		}

		// ------------------------------------------------------------------
		// Security
		// ------------------------------------------------------------------
		function securityEnabledPill(t, info) {
			const enabled = boolOrNull(asObject(info).enabled);
			if (enabled === true) return h(Pill, { tone: "ok" }, t("sec.on"));
			if (enabled === false) return h(Pill, { tone: "warn" }, t("sec.off"));
			return h(Pill, { tone: "idle" }, t("sec.unknown"));
		}

		function SecurityStatusCard(props) {
			const t = props.t;
			const info = asObject(props.info);
			const raw = strOr(info.raw, "");
			return h(
				"div",
				{ className: "dx-card" },
				h(
					"div",
					{ className: "dx-cardHead", style: { marginBottom: "7px" } },
					h("span", { className: "dx-cardHeadIcon" }, h(Icon, { name: props.icon, size: 15 })),
					h("div", { className: "dx-cardTitles" }, h("h2", { className: "dx-cardTitle" }, props.title)),
					h("div", { className: "dx-cardActions" }, securityEnabledPill(t, info)),
				),
				props.extra || null,
				raw ? h("p", { className: "dx-small dx-muted", style: { marginTop: "7px" }, title: raw }, raw) : null,
			);
		}

		function SecurityTab(props) {
			const t = props.t;
			const pending = asObject(props.pending);
			const isWindows = props.platform === "win32";
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 4,
				onRetry: props.onRetry,
				errorsKey: "sec.errors",
				children: (data) => {
					const fileVault = asObject(data.fileVault);
					const sip = asObject(data.sip);
					const gatekeeper = asObject(data.gatekeeper);
					const firewall = asObject(data.firewall);
					const tcc = asObject(data.tcc);
					const users = asObject(data.users);
					const grants = asArray(tcc.grants).filter(isObj);
					const firewallEnabled = boolOrNull(firewall.enabled);
					const firewallToggleLabel = firewallEnabled === true ? t("sec.toggleFirewallOff") : t("sec.toggleFirewallOn");
					return h(
						"div",
						{ className: "dx-section" },
						h(
							"div",
							{ className: "dx-grid3" },
							h(SecurityStatusCard, { t, title: isWindows ? t("sec.bitlocker") : t("sec.fileVault"), icon: "lock", info: fileVault }),
							h(SecurityStatusCard, { t, title: isWindows ? t("sec.secureBoot") : t("sec.sip"), icon: "security", info: sip }),
							h(SecurityStatusCard, { t, title: isWindows ? t("sec.defender") : t("sec.gatekeeper"), icon: "firewall", info: gatekeeper }),
							h(SecurityStatusCard, {
								t,
								title: t("sec.firewall"),
								icon: "firewall",
								info: firewall,
								extra: h(
									Fragment,
									null,
									firewall.stealthMode === true || firewall.stealthMode === false
										? h("div", { className: "dx-small dx-muted" }, t("sec.stealth") + ": " + (firewall.stealthMode ? t("common.on") : t("common.off")))
										: null,
									h(
										"button",
										{
											type: "button",
											className: "dx-btn",
											"data-size": "sm",
											style: { marginTop: "9px" },
											disabled: pending["system.toggleFirewall"] === true,
											onClick: () =>
												props.openConfirm({
													title: firewallEnabled === true ? t("sec.confirmFirewallOff") : t("sec.confirmFirewallOn"),
													description: firewallEnabled === true ? t("sec.confirmFirewallOffBody") : t("sec.confirmFirewallOnBody"),
													confirmLabel: firewallToggleLabel,
													danger: firewallEnabled === true,
													actionId: "system.toggleFirewall",
													params: { enabled: firewallEnabled !== true },
												}),
										},
										firewallToggleLabel,
									),
								),
							}),
						),
						h(Card, {
							title: t("sec.tcc"),
							icon: "users",
							span: 2,
							flush: tcc.readable === true,
							actions: h(
								"button",
								{ type: "button", className: "dx-btn", "data-size": "sm", onClick: () => props.openPane(["privacy", "security"], "privacy") },
								h(Icon, { name: "gear", size: 13 }),
								isWindows ? t("sec.openPrivacyWin") : t("sec.openFileVault"),
							),
							children:
								tcc.readable === true
									? h(DataTable, {
											t,
											ariaLabel: t("sec.tcc"),
											columns: [
												{ key: "service", label: t("sec.service"), render: (row) => strOr(row.service, "—") },
												{ key: "client", label: t("sec.client"), render: (row) => strOr(row.client, "—") },
											],
											rows: grants,
											empty: h(EmptyState, { icon: "security", title: t("sec.noGrants") }),
										})
									: h(
											"div",
											{ className: "dx-empty" },
											h("span", { className: "dx-emptyIcon" }, h(Icon, { name: "lock", size: 22 })),
											h("p", { className: "dx-emptyTitle" }, isWindows ? t("sec.tccUnreadableWin") : t("sec.tccUnreadable")),
											tcc.reason ? h("p", { className: "dx-emptyText" }, t("sec.tccReason", { reason: tcc.reason })) : null,
										),
						}),
						h(
							"div",
							{ className: "dx-grid2" },
							h(Card, {
								title: t("sec.admins"),
								icon: "users",
								actions: h(
									"button",
									{ type: "button", className: "dx-btn", "data-size": "sm", onClick: () => props.openPane(["users", "accounts"], "users") },
									h(Icon, { name: "gear", size: 13 }),
									t("sec.openUsers"),
								),
								children: h(
									Fragment,
									null,
									h(
										"div",
										{ className: "dx-tagList" },
										asArray(users.admins).filter((name) => typeof name === "string").length > 0
											? asArray(users.admins)
													.filter((name) => typeof name === "string")
													.map((name) => h(Pill, { key: name, tone: name === strOr(users.current, "") ? "brand" : "idle" }, name))
											: h("span", { className: "dx-small dx-muted" }, t("sec.noAdmins")),
									),
									h(
										"p",
										{ className: "dx-small dx-muted", style: { marginTop: "10px" } },
										t("sec.adminsCount", { n: asArray(users.admins).length }) + " · " + t("sec.usersCount", { n: numOr(users.total, 0) }),
									),
								),
							}),
							h(Card, {
								title: t("sec.remoteLogin"),
								icon: "network",
								children: h(FactGrid, {
									t,
									items: [
										{ key: "remoteLogin", label: t("sec.remoteLogin"), value: data.remoteLogin === true ? t("sec.remoteLoginOn") : data.remoteLogin === false ? t("sec.remoteLoginOff") : t("sec.unknown") },
										{ key: "autoLogin", label: t("sec.autoLogin"), value: typeof data.autoLogin === "string" ? t("sec.autoLoginUser", { user: data.autoLogin }) : t("sec.autoLoginOff") },
									],
								}),
							}),
						),
						h(Card, {
							title: t("sec.paneTitle"),
							icon: "gear",
							children: h(
								"div",
								{ className: "dx-toolbar" },
								h(
									"button",
									{ type: "button", className: "dx-btn", onClick: () => props.openPane(["privacy", "security", "filevault"], "privacy") },
									h(Icon, { name: "lock", size: 13 }),
									isWindows ? t("sec.openPrivacyWin") : t("sec.openFileVault"),
								),
								h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										onClick: isWindows ? () => props.openPane(["windowsdefender", "windowssecurity"], "windowsdefender") : () => props.openPane(["firewall"], "firewall"),
									},
									h(Icon, { name: "firewall", size: 13 }),
									isWindows ? t("sec.openSecurityWin") : t("sec.openFirewall"),
								),
								isWindows
									? null
									: h(
											"button",
											{ type: "button", className: "dx-btn", onClick: () => props.openPane(["sharing"], "sharing") },
											h(Icon, { name: "network", size: 13 }),
											t("sec.openSharing"),
										),
								h(
									"button",
									{ type: "button", className: "dx-btn", onClick: () => props.openPane(["users", "accounts"], "users") },
									h(Icon, { name: "users", size: 13 }),
									t("sec.openUsers"),
								),
								h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										disabled: pending["system.flushDNS"] === true,
										onClick: () => props.openConfirm({ title: t("sec.confirmFlushDns"), description: t("sec.confirmFlushDnsBody"), confirmLabel: t("sec.flushDns"), danger: false, actionId: "system.flushDNS", params: {} }),
									},
									h(Icon, { name: "refresh", size: 13 }),
									t("sec.flushDns"),
								),
								h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										"data-variant": "danger",
										disabled: pending["system.emptyTrash"] === true,
										onClick: () => props.openConfirm({ title: t("sec.confirmEmptyTrash"), description: t("sec.confirmEmptyTrashBody"), confirmLabel: t("sec.emptyTrash"), danger: true, actionId: "system.emptyTrash", params: {} }),
									},
									h(Icon, { name: "trash", size: 13 }),
									t("sec.emptyTrash"),
								),
							),
						}),
					);
				},
			});
		}

		// ------------------------------------------------------------------
		// Processes
		// ------------------------------------------------------------------
		function ProcessesTab(props) {
			const t = props.t;
			const pending = asObject(props.pending);
			const [search, setSearch] = useState("");
			const [sortDirection, setSortDirection] = useState("desc");
			return h(TabShell, {
				t,
				state: props.state,
				skeletonCards: 2,
				onRetry: props.onRetry,
				errorsKey: "proc.errors",
				children: (data) => {
					const list = asArray(data.list).filter(isObj);
					const query = search.trim().toLowerCase();
					const filtered = list
						.filter((process) => {
							if (query.length === 0) return true;
							const command = strOr(process.command, "").toLowerCase();
							const user = strOr(process.user, "").toLowerCase();
							return command.indexOf(query) >= 0 || user.indexOf(query) >= 0 || String(process.pid).indexOf(query) >= 0;
						})
						.sort((left, right) => {
							const first = numOr(left.cpu, -1);
							const second = numOr(right.cpu, -1);
							return sortDirection === "desc" ? second - first : first - second;
						});
					return h(
						"div",
						{ className: "dx-section" },
						h(Card, {
							title: t("tab.processes"),
							icon: "processes",
							subtitle: t("proc.total", { n: numOr(data.total, list.length) }),
							flush: true,
							actions: h(
								"div",
								{ style: { display: "flex", gap: "8px", alignItems: "center" } },
								h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										"data-size": "sm",
										onClick: () => setSortDirection(sortDirection === "desc" ? "asc" : "desc"),
										title: t("proc.sortByCpu") + " · " + (sortDirection === "desc" ? t("proc.sortDesc") : t("proc.sortAsc")),
										"aria-label": t("proc.sortByCpu"),
									},
									h(Icon, { name: sortDirection === "desc" ? "arrowDown" : "arrowUp", size: 13 }),
									sortDirection === "desc" ? t("proc.sortDesc") : t("proc.sortAsc"),
								),
								h(
									"button",
									{ type: "button", className: "dx-btn", "data-size": "sm", disabled: props.state.status === "loading", onClick: props.onRefresh, title: t("proc.refresh"), "aria-label": t("proc.refresh") },
									h(Icon, { name: "refresh", size: 13 }),
									t("common.refresh"),
								),
							),
							children: h(
								Fragment,
								null,
								h(
									"div",
									{ className: "dx-toolbar", style: { padding: "12px 16px" } },
									h("div", { className: "dx-toolbarLeft" }, h(SearchField, { value: search, onChange: setSearch, placeholder: t("proc.search"), label: t("common.search") })),
									h("div", { className: "dx-toolbarRight" }, h("span", { className: "dx-small dx-muted" }, String(filtered.length) + " / " + String(list.length))),
								),
								h(DataTable, {
									t,
									ariaLabel: t("tab.processes"),
									columns: [
										{ key: "pid", label: t("common.pid"), render: (row) => h("span", { className: "dx-mono" }, String(row.pid)) },
										{
											key: "command",
											label: t("common.process"),
											render: (row) =>
												h(
													"span",
													{ title: strOr(row.command, ""), style: { display: "inline-block", maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" } },
													strOr(row.command, "—"),
												),
										},
										{ key: "user", label: t("common.user"), render: (row) => strOr(row.user, "—") },
										{ key: "cpu", label: t("common.cpu"), align: "right", render: (row) => fmtPercent(row.cpu, 1) },
										{ key: "memPercent", label: t("common.memory"), align: "right", render: (row) => fmtPercent(row.memPercent, 1) },
										{ key: "rssBytes", label: t("proc.rss"), align: "right", render: (row) => fmtBytes(row.rssBytes) },
										{ key: "state", label: t("common.state"), render: (row) => strOr(row.state, "—") },
										{ key: "elapsed", label: t("proc.elapsed"), render: (row) => (row.elapsed === null || row.elapsed === undefined ? "—" : String(row.elapsed)) },
										{
											key: "actions",
											label: t("common.actions"),
											align: "right",
											render: (row) =>
												h(
													"button",
													{
														type: "button",
														className: "dx-btn",
														"data-size": "sm",
														"data-variant": "danger",
														disabled: pending["process.signal"] === true || row.pid === 1,
														title: t("proc.kill"),
														"aria-label": t("proc.kill") + " PID " + row.pid,
														onClick: () => props.openKill({ pid: row.pid, name: strOr(row.command, "PID " + row.pid), signal: "TERM" }),
													},
													h(Icon, { name: "power", size: 13 }),
													t("proc.kill"),
												),
										},
									],
									rows: filtered,
									empty: h(EmptyState, { icon: "processes", title: t("proc.empty") }),
								}),
							),
						}),
					);
				},
			});
		}

		// ------------------------------------------------------------------
		// Action catalogue helpers
		// ------------------------------------------------------------------
		// ------------------------------------------------------------------
		// Hardware: thermals + read-only driver inventory.
		// ------------------------------------------------------------------
		const THERMAL_PRESSURE_KEYS = {
			nominal: "hw.thermal.pressure.nominal",
			fair: "hw.thermal.pressure.fair",
			serious: "hw.thermal.pressure.serious",
			critical: "hw.thermal.pressure.critical",
		};
		const THERMAL_NOTE_KEYS = {
			"cpu-needs-admin": "hw.thermal.note.cpu-needs-admin",
			"wmi-unsupported": "hw.thermal.note.wmi-unsupported",
			unavailable: "hw.thermal.note.unavailable",
		};

		function ThermalCard(props) {
			const t = props.t;
			const thermal = normalizeThermal(props.thermal);
			const pressureLabel = thermal.pressure ? t(THERMAL_PRESSURE_KEYS[thermal.pressure] || THERMAL_PRESSURE_KEYS.nominal) : "";
			const facts = [
				thermal.cpuCelsius !== null ? { key: "cpu", label: t("hw.thermal.cpu"), value: fmtNumber(thermal.cpuCelsius, 1) + " °C" } : null,
				thermal.gpuCelsius !== null ? { key: "gpu", label: t("hw.thermal.gpu"), value: fmtNumber(thermal.gpuCelsius, 1) + " °C" } : null,
				thermal.batteryCelsius !== null ? { key: "battery", label: t("hw.thermal.battery"), value: fmtNumber(thermal.batteryCelsius, 1) + " °C" } : null,
				thermal.nvmeCelsius !== null ? { key: "nvme", label: t("hw.thermal.nvme"), value: fmtNumber(thermal.nvmeCelsius, 1) + " °C" } : null,
				pressureLabel ? { key: "pressure", label: t("hw.thermal.pressure"), value: h(Pill, { tone: thermal.pressure === "nominal" ? "ok" : thermal.pressure === "fair" ? "warn" : "error" }, pressureLabel) } : null,
				...thermal.fans.map((fan, index) => ({
					key: "fan-" + index,
					label: fan.name ? t("hw.thermal.fan", { name: fan.name }) : t("hw.thermal.fans"),
					value: fan.rpm === null ? "—" : fmtNumber(fan.rpm) + " RPM",
				})),
			].filter(Boolean);
			return h(Card, {
				title: t("hw.thermal.title"),
				icon: "spark",
				subtitle: t("hw.thermal.subtitle"),
				children: h(
					Fragment,
					null,
					facts.length > 0 ? h(FactGrid, { t, items: facts, emptyText: t("hw.thermal.none") }) : h(EmptyState, { icon: "spark", title: t("hw.thermal.none") }),
					thermal.note ? h("p", { className: "dx-small dx-muted", style: { marginTop: "10px" } }, t(THERMAL_NOTE_KEYS[thermal.note] || THERMAL_NOTE_KEYS.unavailable)) : null,
					thermal.sources.length > 0 ? h("p", { className: "dx-small dx-muted", style: { marginTop: "8px" } }, t("hw.thermal.sources") + ": " + thermal.sources.join(", ")) : null,
				),
			});
		}

		function DriversCard(props) {
			const t = props.t;
			const [query, setQuery] = useState("");
			const drivers = asArray(props.drivers).filter(isObj);
			const summary = asObject(props.summary);
			const problems = asArray(props.problems).filter(isObj).slice(0, 20);
			if (drivers.length === 0) {
				return h(Card, { title: t("hw.drivers.title"), icon: "gear", subtitle: t("hw.drivers.subtitle"), span: 2, children: h(EmptyState, { icon: "gear", title: t("hw.drivers.none") }) });
			}
			const needle = query.trim().toLowerCase();
			const matched = needle
				? drivers.filter((driver) =>
						[driver.name, driver.class, driver.manufacturer, driver.signer, driver.deviceId, driver.bundleId].some(
							(value) => typeof value === "string" && value.toLowerCase().indexOf(needle) >= 0,
						),
					)
				: drivers;
			const rows = matched.slice(0, 60);
			const total = numOrNull(summary.total) ?? drivers.length;
			const badges = [
				h(Pill, { key: "total", tone: "idle" }, t("hw.drivers.total", { n: total })),
				numOrNull(summary.thirdParty) ? h(Pill, { key: "third", tone: "brand" }, t("hw.drivers.thirdParty", { n: summary.thirdParty })) : null,
				numOrNull(summary.problems) && summary.problems > 0 ? h(Pill, { key: "problems", tone: "error" }, t("hw.drivers.problems", { n: summary.problems })) : null,
			].filter(Boolean);
			return h(Card, {
				title: t("hw.drivers.title"),
				icon: "gear",
				subtitle: t("hw.drivers.subtitle"),
				span: 2,
				actions: h("div", { style: { width: "190px" } }, h(SearchField, { value: query, placeholder: t("hw.drivers.search"), label: t("hw.drivers.search"), onChange: setQuery })),
				children: h(
					Fragment,
					null,
					h("div", { className: "dx-tagList", style: { marginBottom: "10px" } }, badges),
					rows.length === 0
						? h(EmptyState, { icon: "search", title: t("hw.drivers.noMatch") })
						: h(DataTable, {
								t,
								columns: [
									{ key: "name", label: t("hw.drivers.name"), render: (row) => strOr(row.name, strOr(row.bundleId, "—")) },
									{ key: "class", label: t("hw.drivers.class"), render: (row) => strOr(row.class, strOr(row.kind, "—")) },
									{ key: "vendor", label: t("hw.drivers.vendor"), render: (row) => strOr(row.manufacturer, "—") },
									{ key: "version", label: t("hw.drivers.version"), render: (row) => strOr(row.version, "—") },
									{ key: "date", label: t("hw.drivers.date"), render: (row) => strOr(row.date, "—") },
									{ key: "signer", label: t("hw.drivers.signer"), render: (row) => strOr(row.signer, "—") },
								],
								rows,
							}),
					matched.length > rows.length ? h("p", { className: "dx-small dx-muted", style: { marginTop: "8px" } }, "… " + String(matched.length - rows.length)) : null,
					problems.length > 0
						? h(
								"div",
								{ style: { marginTop: "12px" } },
								h("div", { className: "dx-factLabel", style: { marginBottom: "6px" } }, t("hw.drivers.problems", { n: problems.length })),
								h(
									"div",
									{ className: "dx-sublist" },
									problems.map((problem, index) =>
										h(SubCard, {
											key: index,
											title: strOr(problem.name, "—"),
											icon: "warning",
											badge: h(Pill, { tone: "error" }, t("hw.drivers.problemCode", { code: strOr(problem.code, "?") })),
										}),
									),
								),
							)
						: null,
					h("p", { className: "dx-small dx-muted", style: { marginTop: "10px" } }, t("hw.drivers.readOnly")),
				),
			});
		}

		// ------------------------------------------------------------------
		// Cleanup: allowlisted scan + explicit, confirmed deletion.
		// ------------------------------------------------------------------
		const CLEANUP_CATEGORY_KEYS = {
			cache: "cleanup.item.cache",
			logs: "cleanup.item.logs",
			trash: "cleanup.item.trash",
			temp: "cleanup.item.temp",
			developer: "cleanup.item.developer",
			updates: "cleanup.item.updates",
		};

		function CleanupTab(props) {
			const t = props.t;
			const [state, setState] = useState({ status: "loading", data: null, error: null });
			const [selected, setSelected] = useState({});
			const [confirming, setConfirming] = useState(false);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState("");
			const inFlight = useRef(null);
			const load = useCallback((fresh) => {
				if (inFlight.current) return inFlight.current;
				setState((previous) => ({ status: previous.data ? "ready" : "loading", data: previous.data, error: null }));
				const promise = api
					.cleanup(fresh === true)
					.then((raw) => setState({ status: "ready", data: normalizeCleanup(raw), error: null }))
					.catch((error) => setState((previous) => ({ status: previous.data ? "ready" : "error", data: previous.data, error })))
					.finally(() => {
						inFlight.current = null;
					});
				inFlight.current = promise;
				return promise;
			}, []);
			useEffect(() => {
				load(false);
			}, [load]);
			const data = state.data;
			if (state.status === "loading" && !data) {
				return h(Fragment, null, h(Skeleton, { cards: 3 }), h("p", { className: "dx-loadingHint", role: "status" }, t("cleanup.scanning")));
			}
			if (state.status === "error" && !data) {
				return h(ErrorState, { t, title: t("cleanup.error"), text: safeErrorText(state.error), onRetry: () => load(true), retryLabel: t("common.retry") });
			}
			const items = data ? data.items : [];
			const selectable = items.filter((item) => item.exists !== false && item.bytes > 0);
			const selectedItems = selectable.filter((item) => selected[item.id] === true);
			const selectedBytes = selectedItems.reduce((total, item) => total + item.bytes, 0);
			const selectedFiles = selectedItems.reduce((total, item) => total + item.files, 0);
			const allSelected = selectable.length > 0 && selectedItems.length === selectable.length;
			const toggleItem = (id) => {
				setNotice("");
				setConfirming(false);
				setSelected((previous) => Object.assign({}, previous, { [id]: previous[id] !== true }));
			};
			const selectAll = () => {
				setNotice("");
				setConfirming(false);
				if (allSelected) {
					setSelected({});
					return;
				}
				const next = {};
				for (const item of selectable) next[item.id] = true;
				setSelected(next);
			};
			const runDelete = async () => {
				if (selectedItems.length === 0) {
					setNotice(t("cleanup.noneSelected"));
					return;
				}
				setBusy(true);
				setNotice("");
				const ids = selectedItems.map((item) => item.id);
				const result = await props.onAction("cleanup.delete", { ids });
				setBusy(false);
				setConfirming(false);
				if (result && result.ok) {
					setSelected({});
					await load(true);
				}
			};
			return h(
				"div",
				{ className: "dx-section" },
				h(Card, {
					title: t("tab.cleanup"),
					icon: "trash",
					subtitle: t("cleanup.intro"),
					actions: h(
						"button",
						{ type: "button", className: "dx-btn", "data-size": "sm", onClick: () => load(true), disabled: state.status === "loading" },
						h(Icon, { name: "refresh", size: 13 }),
						t("cleanup.scan"),
					),
					children: h(
						Fragment,
						null,
						h(
							"div",
							{ className: "dx-cleanupTop" },
							h(
								"div",
								null,
								h("div", { className: "dx-cleanupTotal" }, fmtBytes(data ? data.totalBytes : 0)),
								h(
									"div",
									{ className: "dx-cleanupMeta" },
									t("cleanup.reclaimable") +
										" · " +
										t("cleanup.files", { n: data ? data.totalFiles : 0 }) +
										(data && data.generatedAt ? " · " + t("cleanup.updated", { time: fmtTime(data.generatedAt) }) : ""),
								),
							),
							h("span", { className: "dx-grow" }),
							h(
								"div",
								{ className: "dx-cleanActions" },
								h("button", { type: "button", className: "dx-linkBtn", onClick: selectAll, disabled: selectable.length === 0 }, allSelected ? t("cleanup.selectNone") : t("cleanup.selectAll")),
								h(
									"button",
									{
										type: "button",
										className: "dx-btn",
										"data-variant": "primary",
										onClick: () => {
											if (selectedItems.length === 0) {
												setNotice(t("cleanup.noneSelected"));
												return;
											}
											setConfirming(true);
										},
										disabled: busy || selectedItems.length === 0,
									},
									h(Icon, { name: "trash", size: 13 }),
									busy ? t("cleanup.deleting") : t("cleanup.delete"),
								),
							),
						),
						h("p", { className: "dx-small dx-muted", style: { marginTop: "8px" } }, t("cleanup.selected", { value: fmtBytes(selectedBytes) }) + (selectedItems.length > 0 ? " · " + t("cleanup.files", { n: selectedFiles }) : "")),
						notice ? h("div", { className: "dx-banner", "data-tone": "warn", role: "status" }, h("span", { className: "dx-bannerText" }, notice)) : null,
						confirming
							? h(
									"div",
									{ className: "dx-banner", "data-tone": "danger", role: "alert" },
									h("span", { className: "dx-bannerText" }, t("cleanup.confirmTitle") + " " + t("cleanup.confirmBody", { value: fmtBytes(selectedBytes), n: selectedFiles })),
									h(
										"div",
										{ className: "dx-cleanActions" },
										h("button", { type: "button", className: "dx-btn", "data-size": "sm", onClick: () => setConfirming(false), disabled: busy }, t("cleanup.cancel")),
										h("button", { type: "button", className: "dx-btn", "data-variant": "danger", "data-size": "sm", onClick: runDelete, disabled: busy }, t("cleanup.confirmLabel")),
									),
								)
							: null,
						h(
							"div",
							{ className: "dx-cleanupRows" },
							items.length === 0
								? h(EmptyState, { icon: "trash", title: t("cleanup.scanEmpty") })
								: items.map((item) =>
										h(
											"div",
											{ className: "dx-cleanRow", key: item.id },
											h("input", {
												type: "checkbox",
												className: "dx-cleanCheck",
												checked: selected[item.id] === true,
												disabled: item.exists === false || item.bytes === 0,
												"aria-label": item.label,
												onChange: () => toggleItem(item.id),
											}),
											h(
												"div",
												{ className: "dx-cleanMain" },
												h(
													"div",
													{ className: "dx-cleanTitle" },
													item.label,
													h(Pill, { tone: "idle" }, t(CLEANUP_CATEGORY_KEYS[item.category] || "cleanup.item.cache")),
													item.requiresAdmin ? h(Pill, { tone: "warn", title: t("cleanup.adminHint") }, t("cleanup.admin")) : null,
													item.exists === false ? h(Pill, { tone: "idle" }, t("common.na")) : null,
												),
												item.detail ? h("div", { className: "dx-cleanPath" }, item.detail) : null,
												item.path ? h("div", { className: "dx-cleanPath", title: item.path }, item.path) : null,
												item.error ? h("div", { className: "dx-cleanPath" }, item.error) : null,
											),
											h("div", { className: "dx-cleanSize" }, h("div", null, fmtBytes(item.bytes)), h("div", { className: "dx-cleanSizeSub" }, t("cleanup.files", { n: item.files }))),
										),
									),
						),
					),
				}),
			);
		}

		// ------------------------------------------------------------------
		// Benchmark: fixed-work, repeatable, on demand.
		// ------------------------------------------------------------------
		function BenchmarkDelta(props) {
			const t = props.t;
			const previous = props.previous;
			if (!previous || typeof previous.score !== "number" || typeof props.score !== "number" || previous.score === 0) return null;
			const percent = ((props.score - previous.score) / previous.score) * 100;
			if (!isFiniteNumber(percent)) return null;
			const abs = Math.abs(percent);
			const tone = abs < 1 ? "flat" : percent > 0 ? "up" : "down";
			const label = tone === "flat" ? t("bench.flat") : t(tone === "up" ? "bench.better" : "bench.worse", { value: abs.toFixed(1) + "%" });
			return h(
				"span",
				{ className: "dx-benchDelta", "data-tone": tone },
				tone === "flat" ? null : h(Icon, { name: tone === "up" ? "arrowUp" : "arrowDown", size: 12 }),
				label,
			);
		}

		function BenchmarkTab(props) {
			const t = props.t;
			const [state, setState] = useState({ status: "idle", run: null, error: null });
			const [running, setRunning] = useState(false);
			const run = async () => {
				if (running) return;
				setRunning(true);
				setState((previous) => ({ status: previous.run ? "ready" : "loading", run: previous.run, error: null }));
				const result = await api.benchmark({});
				setRunning(false);
				if (!result.ok || !result.benchmark) {
					setState((previous) => ({ status: previous.run ? "ready" : "error", run: previous.run, error: new Error(result.message || "benchmark failed") }));
					return;
				}
				setState({ status: "ready", run: result.benchmark, error: null });
			};
			const runData = state.run;
			const previousScores = {};
			if (runData && runData.previous) {
				for (const entry of asArray(runData.previous.results)) previousScores[strOr(entry.id, "")] = entry;
			}
			const results = runData ? asArray(runData.results) : [];
			const env = runData ? asObject(runData.environment) : {};
			const labelOf = { cpu: "bench.cpu", memory: "bench.memory", disk: "bench.disk" };
			const iconOf = { cpu: "cpu", memory: "memory", disk: "disk" };
			return h(
				"div",
				{ className: "dx-section" },
				h(Card, {
					title: t("tab.benchmark"),
					icon: "spark",
					subtitle: t("bench.intro"),
					actions: h(
						"button",
						{ type: "button", className: "dx-btn", "data-variant": "primary", "data-size": "sm", onClick: run, disabled: running },
						h(Icon, { name: "spark", size: 13 }),
						running ? t("bench.running") : runData ? t("bench.rerun") : t("bench.run"),
					),
					children: h(
						Fragment,
						null,
						running ? h("p", { className: "dx-small dx-muted", role: "status" }, t("bench.runningHint")) : null,
						state.status === "error" && !runData
							? h(ErrorState, { t, title: t("error.section"), text: safeErrorText(state.error), onRetry: run, retryLabel: t("common.retry") })
							: null,
						!runData && state.status !== "error" ? h(EmptyState, { icon: "spark", title: t("bench.empty") }) : null,
						results.length > 0
							? h(
									"div",
									{ className: "dx-benchGrid" },
									results.map((result) => {
										const details = asObject(result.details);
										const previous = previousScores[result.id];
										const body = [];
										if (result.id === "cpu") {
											const single = asObject(details.singleThread);
											const multi = asObject(details.multiThread);
											body.push(
												h(
													"div",
													{ className: "dx-benchFacts" },
													isFiniteNumber(single.score) ? h("span", { className: "dx-benchMeta", key: "single" }, t("bench.single") + ": " + fmtNumber(single.score, 0) + " ops/s") : null,
													isFiniteNumber(multi.score) ? h("span", { className: "dx-benchMeta", key: "multi" }, t("bench.multi") + ": " + fmtNumber(multi.score, 0) + " ops/s" + (isFiniteNumber(multi.threads) ? " · " + t("bench.threads", { n: multi.threads }) : "")) : null,
												),
											);
										} else if (result.id === "disk") {
											body.push(
												h(
													"div",
													{ className: "dx-benchFacts" },
													isFiniteNumber(details.writeMBps) ? h("span", { className: "dx-benchMeta", key: "write" }, t("bench.write") + ": " + fmtNumber(details.writeMBps, 1) + " MB/s") : null,
													isFiniteNumber(details.readMBps) ? h("span", { className: "dx-benchMeta", key: "read" }, t("bench.read") + ": " + fmtNumber(details.readMBps, 1) + " MB/s") : null,
												),
											);
										} else {
											body.push(
												h(
													"div",
													{ className: "dx-benchFacts" },
													isFiniteNumber(details.megabytes) ? h("span", { className: "dx-benchMeta", key: "bytes" }, fmtBytes(details.megabytes * 1024 * 1024)) : null,
												),
											);
										}
										return h(
											"div",
											{ className: "dx-benchCard", key: result.id },
											h(
												"div",
												{ className: "dx-benchHead" },
												h(Icon, { name: iconOf[result.id] || "spark", size: 15 }),
												h("span", { className: "dx-benchTitle" }, t(labelOf[result.id] || "bench.cpu")),
												h(BenchmarkDelta, { t, previous, score: result.score }),
											),
											result.error
												? h("div", { className: "dx-small", style: { color: "var(--dsw-alias-state-error-primary)" } }, t("bench.failed", { message: result.error }))
												: h(
														Fragment,
														null,
														h("div", null, h("span", { className: "dx-benchScore" }, result.score === null ? "—" : fmtNumber(result.score, result.score < 100 ? 1 : 0)), h("span", { className: "dx-benchUnit" }, result.unit)),
														h("div", { className: "dx-benchMeta" }, t("bench.duration", { value: fmtMs(result.durationMs) })),
														...body,
													),
										);
									}),
								)
							: null,
						runData
							? h(
									"div",
									{ className: "dx-benchFacts", style: { marginTop: "14px" } },
									env.cpuModel ? h("span", { className: "dx-benchMeta" }, env.cpuModel) : null,
									isFiniteNumber(env.logicalCores) ? h("span", { className: "dx-benchMeta" }, t("bench.cores", { n: env.logicalCores })) : null,
									isFiniteNumber(env.memoryBytes) ? h("span", { className: "dx-benchMeta" }, t("bench.memoryTotal", { value: fmtBytes(env.memoryBytes) })) : null,
									env.osVersion ? h("span", { className: "dx-benchMeta" }, env.osVersion) : null,
									isFiniteNumber(runData.durationMs) ? h("span", { className: "dx-benchMeta" }, t("bench.totalDuration", { value: fmtMs(runData.durationMs) })) : null,
								)
							: null,
						runData && runData.previous === null ? h("p", { className: "dx-small dx-muted", style: { marginTop: "8px" } }, t("bench.noPrevious")) : null,
					),
				}),
			);
		}

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
