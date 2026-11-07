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
import { Modal } from "./components/Modal";
import { Toasts } from "./components/Toasts";
import { ActionsTab } from "./components/ActionsTab";
import { actionLabel, optionLabel } from "./action-helpers.js";
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
