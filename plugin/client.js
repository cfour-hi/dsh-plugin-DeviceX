window.__ModuleLoader__.load({
	id: "@local/dsh-devicex",
	factory: (require) => {
		/**
		 * Device X — the browser half of the plugin.
		 *
		 * One page that shows everything about this machine and lets the user act
		 * on whatever is not hardware. The module is a plain module-loader bundle:
		 * no JSX build step, no external libraries, no other harness client package
		 * is required. Only `react` (a platform seed word) is imported.
		 *
		 * Data comes exclusively from the plugin's own same-origin HTTP API:
		 *   GET  /devicex/api/metrics
		 *   GET  /devicex/api/inventory?section=…[&fresh=1]
		 *   GET  /devicex/api/actions
		 *   POST /devicex/api/action
		 *
		 * Everything a Host payload can contain is treated as untrusted: render
		 * helpers read through defensive accessors and never throw, and every tab
		 * body sits behind a small error boundary so one bad payload can never
		 * blank the panel.
		 */
		const React = require("react");
		const h = React.createElement;
		const useState = React.useState;
		const useEffect = React.useEffect;
		const useRef = React.useRef;
		const useCallback = React.useCallback;
		const Fragment = React.Fragment;

		/** Dictionary namespace owned by this plugin page. */
		const NS = "devicex";
		/** Panel key shared by the main panel and its sidebar icon entry. */
		const PANEL_ID = "devicex";
		/** Metrics poll cadence while the page is mounted. */
		const POLL_MS = 2500;
		/** Client-side ring buffer length for the Overview sparklines. */
		const MAX_SAMPLES = 60;

		const TAB_IDS = ["overview", "hardware", "system", "software", "network", "security", "processes", "actions"];
		const TAB_LABEL_KEYS = {
			overview: "tab.overview",
			hardware: "tab.hardware",
			system: "tab.system",
			software: "tab.software",
			network: "tab.network",
			security: "tab.security",
			processes: "tab.processes",
			actions: "tab.actions",
		};
		const TAB_ICONS = {
			overview: "overview",
			hardware: "cpu",
			system: "system",
			software: "software",
			network: "network",
			security: "security",
			processes: "processes",
			actions: "actions",
		};
		/** Tabs backed by a lazily fetched inventory section (key === section name). */
		const SECTION_TABS = {
			hardware: "hardware",
			system: "system",
			software: "software",
			network: "network",
			security: "security",
			processes: "processes",
		};
		/** Action groups in the frozen catalogue order. */
		const ACTION_GROUPS = ["process", "app", "system", "network", "software", "power"];
		const GROUP_LABEL_KEYS = {
			process: "act.groups.process",
			app: "act.groups.app",
			system: "act.groups.system",
			network: "act.groups.network",
			software: "act.groups.software",
			power: "act.groups.power",
		};
		const GROUP_ICONS = {
			process: "processes",
			app: "software",
			system: "gear",
			network: "network",
			software: "software",
			power: "power",
		};
		/** Labels for the parameter names used by the frozen action table. */
		const PARAM_LABEL_KEYS = {
			pid: "act.param.pid",
			signal: "act.param.signal",
			name: "act.param.name",
			path: "act.param.path",
			mode: "act.param.mode",
			kind: "act.param.kind",
			value: "act.param.value",
			percent: "act.param.percent",
			enabled: "act.param.enabled",
			pane: "act.param.pane",
			service: "act.param.service",
			servers: "act.param.servers",
		};
		const PARAM_PLACEHOLDER_KEYS = {
			pid: "act.paramPlaceholder.pid",
			name: "act.paramPlaceholder.name",
			path: "act.paramPlaceholder.path",
			value: "act.paramPlaceholder.value",
			pane: "act.paramPlaceholder.pane",
			service: "act.paramPlaceholder.service",
			servers: "act.paramPlaceholder.servers",
		};
		/** Human labels for select values used by the frozen action table. */
		const OPTION_LABEL_KEYS = {
			trash: "act.mode.trash",
			delete: "act.mode.delete",
			HostName: "act.kind.HostName",
			ComputerName: "act.kind.ComputerName",
			LocalHostName: "act.kind.LocalHostName",
			TERM: "proc.signal.TERM",
			KILL: "proc.signal.KILL",
			INT: "proc.signal.INT",
			STOP: "proc.signal.STOP",
			CONT: "proc.signal.CONT",
		};
		const SIGNALS = ["TERM", "KILL", "INT", "STOP", "CONT"];
		const DANGER_LABEL_KEYS = { low: "act.danger.low", medium: "act.danger.medium", high: "act.danger.high" };
		/**
		 * Client-side presentation map keyed by the frozen action ids (the
		 * catalogue from the Host is authoritative for existence/params; this map
		 * supplies translated labels, icons and safe fallback badges when the
		 * catalogue has not loaded yet).
		 */
		const ACTION_META = {
			"process.signal": { group: "process", danger: "high", requiresAdmin: false, icon: "signal", labelKey: "action.process.signal", descKey: "action.process.signal.desc" },
			"app.quit": { group: "app", danger: "low", requiresAdmin: false, icon: "power", labelKey: "action.app.quit", descKey: "action.app.quit.desc" },
			"app.launch": { group: "app", danger: "low", requiresAdmin: false, icon: "arrowUp", labelKey: "action.app.launch", descKey: "action.app.launch.desc" },
			"app.reveal": { group: "app", danger: "low", requiresAdmin: false, icon: "reveal", labelKey: "action.app.reveal", descKey: "action.app.reveal.desc" },
			"app.uninstall": { group: "app", danger: "high", requiresAdmin: false, icon: "trash", labelKey: "action.app.uninstall", descKey: "action.app.uninstall.desc" },
			"system.setHostname": { group: "system", danger: "medium", requiresAdmin: true, icon: "system", labelKey: "action.system.setHostname", descKey: "action.system.setHostname.desc" },
			"system.setVolume": { group: "system", danger: "low", requiresAdmin: false, icon: "audio", labelKey: "action.system.setVolume", descKey: "action.system.setVolume.desc" },
			"system.setDarkMode": { group: "system", danger: "low", requiresAdmin: false, icon: "display", labelKey: "action.system.setDarkMode", descKey: "action.system.setDarkMode.desc" },
			"system.launchAgent": { group: "system", danger: "medium", requiresAdmin: true, icon: "agent", labelKey: "action.system.launchAgent", descKey: "action.system.launchAgent.desc" },
			"system.openSettings": { group: "system", danger: "low", requiresAdmin: false, icon: "gear", labelKey: "action.system.openSettings", descKey: "action.system.openSettings.desc" },
			"system.toggleFirewall": { group: "system", danger: "high", requiresAdmin: true, icon: "firewall", labelKey: "action.system.toggleFirewall", descKey: "action.system.toggleFirewall.desc" },
			"system.flushDNS": { group: "system", danger: "low", requiresAdmin: false, icon: "network", labelKey: "action.system.flushDNS", descKey: "action.system.flushDNS.desc" },
			"system.emptyTrash": { group: "system", danger: "high", requiresAdmin: false, icon: "trash", labelKey: "action.system.emptyTrash", descKey: "action.system.emptyTrash.desc" },
			"network.setWifiPower": { group: "network", danger: "medium", requiresAdmin: false, icon: "wifi", labelKey: "action.network.setWifiPower", descKey: "action.network.setWifiPower.desc" },
			"network.setDns": { group: "network", danger: "medium", requiresAdmin: true, icon: "network", labelKey: "action.network.setDns", descKey: "action.network.setDns.desc" },
			"power.sleep": { group: "power", danger: "low", requiresAdmin: false, icon: "sleep", labelKey: "action.power.sleep", descKey: "action.power.sleep.desc" },
			"power.lock": { group: "power", danger: "low", requiresAdmin: false, icon: "lock", labelKey: "action.power.lock", descKey: "action.power.lock.desc" },
			"software.brewUninstall": { group: "software", danger: "medium", requiresAdmin: false, icon: "software", labelKey: "action.software.brewUninstall", descKey: "action.software.brewUninstall.desc" },
		};
		/** Inline stroke icons. All inherit `currentColor`; no external assets. */
		const ICONS = {
			overview: [["rect", { x: 3.5, y: 3.5, width: 7, height: 7, rx: 2 }], ["rect", { x: 13.5, y: 3.5, width: 7, height: 7, rx: 2 }], ["rect", { x: 3.5, y: 13.5, width: 7, height: 7, rx: 2 }], ["rect", { x: 13.5, y: 13.5, width: 7, height: 7, rx: 2 }]],
			cpu: [["rect", { x: 6.5, y: 6.5, width: 11, height: 11, rx: 2.5 }], ["rect", { x: 9.5, y: 9.5, width: 5, height: 5, rx: 1 }], ["path", { d: "M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" }]],
			system: [["rect", { x: 3.5, y: 4.5, width: 17, height: 12, rx: 2 }], ["path", { d: "M8 20.5h8M12 16.5v4" }]],
			software: [["rect", { x: 4.5, y: 4.5, width: 15, height: 15, rx: 3 }], ["path", { d: "M4.5 9.5h15M9.5 9.5v10" }]],
			network: [["path", { d: "M2.5 9a14 14 0 0119 0M5.5 12.5a9 9 0 0113 0M8.5 16a5.5 5.5 0 017 0" }], ["circle", { cx: 12, cy: 19.5, r: 1.2 }]],
			security: [["path", { d: "M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" }], ["path", { d: "M9 12l2.2 2.2L15.5 10" }]],
			processes: [["path", { d: "M4 6h16M4 12h10M4 18h13" }], ["circle", { cx: 18.5, cy: 17.5, r: 2 }]],
			actions: [["path", { d: "M13 2.5L4.5 13.5H11l-1 8 8.5-11H12l1-8z" }]],
			refresh: [["path", { d: "M20 12a8 8 0 10-2.3 5.7M20 5.5V11h-5.5" }]],
			spark: [["path", { d: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" }]],
			close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
			search: [["circle", { cx: 11, cy: 11, r: 6.5 }], ["path", { d: "M20 20l-4.2-4.2" }]],
			warning: [["path", { d: "M12 3.5L22 20H2L12 3.5z" }], ["path", { d: "M12 9.5v5M12 17.5v.5" }]],
			check: [["path", { d: "M4.5 12.5l4.5 4.5L19.5 6.5" }]],
			info: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 11v5.5M12 7.8v.4" }]],
			arrowUp: [["path", { d: "M12 19V5M5.5 11.5L12 5l6.5 6.5" }]],
			arrowDown: [["path", { d: "M12 5v14M5.5 12.5L12 19l6.5-6.5" }]],
			battery: [["rect", { x: 2.5, y: 7.5, width: 16, height: 9, rx: 2.5 }], ["path", { d: "M21.5 10.5v3" }]],
			memory: [["rect", { x: 3.5, y: 7.5, width: 17, height: 9, rx: 2 }], ["path", { d: "M8 16.5v3M12 16.5v3M16 16.5v3M7.5 10.5v3M12 10.5v3M16.5 10.5v3" }]],
			disk: [["ellipse", { cx: 12, cy: 6.5, rx: 7.5, ry: 3 }], ["path", { d: "M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" }]],
			wifi: [["path", { d: "M2.5 9a14 14 0 0119 0M5.5 12.5a9 9 0 0113 0M8.5 16a5.5 5.5 0 017 0" }], ["circle", { cx: 12, cy: 19.5, r: 1.2 }]],
			gpu: [["rect", { x: 3.5, y: 6.5, width: 17, height: 11, rx: 2.5 }], ["path", { d: "M8 10h3v3H8zM13 10h3M13 13h3" }]],
			display: [["rect", { x: 3.5, y: 4.5, width: 17, height: 11, rx: 2 }], ["path", { d: "M8 20h8M12 15.5V20" }]],
			usb: [["path", { d: "M12 3v13M12 16a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 8l4-5 4 5M8 8v3a4 4 0 004 4M16 8v3a4 4 0 01-4 4" }]],
			bluetooth: [["path", { d: "M8 7l7 5-3.5 4V4L15 8 8 13" }]],
			audio: [["path", { d: "M4 10v4h3.5L13 18V6L7.5 10H4z" }], ["path", { d: "M16 9.5a4 4 0 010 5M18.5 7a7 7 0 010 10" }]],
			camera: [["rect", { x: 3, y: 7, width: 12.5, height: 10, rx: 2 }], ["path", { d: "M15.5 11l5-3v8l-5-3" }]],
			users: [["circle", { cx: 9, cy: 8, r: 3.5 }], ["path", { d: "M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5a3.5 3.5 0 010 7M17.5 14.5c2.4.6 4 2.5 4 5.5" }]],
			boot: [["path", { d: "M12 4v8M8 6.5a7 7 0 104 0" }]],
			agent: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" }]],
			env: [["path", { d: "M4 7l4.5 5L4 17M11 17h8" }]],
			locale: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M3.5 12h17M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5S14.5 18.2 12 20.5C9.5 18.2 8.2 15.2 8.2 12S9.5 5.8 12 3.5z" }]],
			power: [["path", { d: "M12 3v8" }], ["path", { d: "M7 6.2a7.5 7.5 0 108 0" }]],
			lock: [["rect", { x: 4.5, y: 10.5, width: 15, height: 10, rx: 2.5 }], ["path", { d: "M8 10.5V8a4 4 0 018 0v2.5" }]],
			signal: [["path", { d: "M3 12h2M8 8v8M12 5v14M16 8v8M20 11v2" }]],
			trash: [["path", { d: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" }]],
			reveal: [["path", { d: "M3 6.5A2.5 2.5 0 015.5 4H10l2 2.5h6.5A2.5 2.5 0 0121 9v8a2.5 2.5 0 01-2.5 2.5H5.5A2.5 2.5 0 013 17V6.5z" }], ["path", { d: "M9 13l2.5 2.5L16 13" }]],
			clock: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 7.5V12l3 2" }]],
			sleep: [["path", { d: "M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" }]],
			gear: [["circle", { cx: 12, cy: 12, r: 3.2 }], ["path", { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" }]],
			firewall: [["rect", { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ["path", { d: "M3.5 9.5h17M3.5 14.5h17M8 4.5v15M14.5 4.5v15" }]],
			database: [["ellipse", { cx: 12, cy: 6.5, rx: 7.5, ry: 3 }], ["path", { d: "M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" }]],
			chevron: [["path", { d: "M9 5l7 7-7 7" }]],
			sort: [["path", { d: "M7 4v16M3.5 7.5L7 4l3.5 3.5M17 20V4M13.5 16.5L17 20l3.5-3.5" }]],
			plus: [["path", { d: "M12 5v14M5 12h14" }]],
		};

		// ------------------------------------------------------------------
		// Safe value helpers. Every Host payload field is untrusted: these
		// accessors never throw and never produce `undefined` in rendered text.
		// ------------------------------------------------------------------
		const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		const asObject = (value) => (isObj(value) ? value : {});
		const asArray = (value) => (Array.isArray(value) ? value : []);
		const isFiniteNumber = (value) => typeof value === "number" && isFinite(value);
		const numOr = (value, fallback) => (isFiniteNumber(value) ? value : fallback);
		const numOrNull = (value) => (isFiniteNumber(value) ? value : null);
		const strOr = (value, fallback) => (typeof value === "string" && value.length > 0 ? value : fallback === void 0 ? "" : fallback);
		const boolOrNull = (value) => (value === true ? true : value === false ? false : null);
		const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
		const joinClass = (...parts) => parts.filter((part) => typeof part === "string" && part.length > 0).join(" ");

		/** Interpolate `{name}` placeholders; a missing parameter stays literal. */
		function interpolate(template, params) {
			if (typeof template !== "string" || !params) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
		}
		/** Build a translator over one dictionary (used as a defensive fallback). */
		function makeTranslator(dict) {
			return (key, params) => {
				const template = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
				return interpolate(template, params);
			};
		}
		const FALLBACK_T = makeTranslator(null);

		const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
		/** Format a byte count for compact display; `null` renders as an em dash. */
		function fmtBytes(value) {
			if (!isFiniteNumber(value) || value < 0) return "—";
			if (value < 1024) return Math.round(value) + " B";
			let scaled = value;
			let unit = 0;
			while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
				scaled /= 1024;
				unit += 1;
			}
			const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 1;
			return scaled.toFixed(digits) + " " + BYTE_UNITS[unit];
		}
		function fmtRate(value) {
			if (!isFiniteNumber(value) || value < 0) return "—";
			return fmtBytes(value) + "/s";
		}
		function fmtPercent(value, digits) {
			if (!isFiniteNumber(value)) return "—";
			const place = typeof digits === "number" ? digits : 0;
			return value.toFixed(place) + "%";
		}
		function fmtNumber(value, digits) {
			if (!isFiniteNumber(value)) return "—";
			return digits ? value.toFixed(digits) : String(Math.round(value));
		}
		/** Compact uptime, at most two units ("3 d 4 h", "12 min"). */
		function fmtUptime(seconds, t) {
			if (!isFiniteNumber(seconds) || seconds < 0) return "—";
			const total = Math.floor(seconds);
			const day = Math.floor(total / 86400);
			const hour = Math.floor((total % 86400) / 3600);
			const minute = Math.floor((total % 3600) / 60);
			const parts = [];
			if (day > 0) parts.push(day + " " + t("unit.day"));
			if (hour > 0) parts.push(hour + " " + t("unit.hour"));
			if (day === 0 && parts.length === 0) parts.push(minute + " " + t("unit.minute"));
			if (parts.length === 0) parts.push(t("unit.lessThanMinute"));
			return parts.slice(0, 2).join(" ");
		}
		function fmtTime(ts) {
			if (!isFiniteNumber(ts) || ts <= 0) return "—";
			try {
				return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
			} catch (_error) {
				return "—";
			}
		}
		function fmtDateTime(ts) {
			if (!isFiniteNumber(ts) || ts <= 0) return "—";
			try {
				return new Date(ts).toLocaleString();
			} catch (_error) {
				return "—";
			}
		}
		function percentOf(part, total) {
			if (!isFiniteNumber(part) || !isFiniteNumber(total) || total <= 0) return null;
			return clamp((part / total) * 100, 0, 100);
		}
		/** Palette choice for a 0..100 usage value (theme tokens only). */
		function usageTone(percent) {
			if (!isFiniteNumber(percent)) return "var(--dsw-alias-state-idle-primary)";
			if (percent >= 92) return "var(--dsw-alias-state-error-primary)";
			if (percent >= 78) return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-brand-primary)";
		}
		function pressureTone(pressure) {
			if (pressure === "critical") return "var(--dsw-alias-state-error-primary)";
			if (pressure === "warning") return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-state-success-primary)";
		}
		function pressureKey(pressure) {
			if (pressure === "critical") return "overview.memPressure.critical";
			if (pressure === "warning") return "overview.memPressure.warning";
			return "overview.memPressure.normal";
		}
		/** RSSI → 0..4 signal bars. */
		function rssiLevel(rssi) {
			if (!isFiniteNumber(rssi)) return 0;
			if (rssi >= -55) return 4;
			if (rssi >= -67) return 3;
			if (rssi >= -78) return 2;
			if (rssi >= -90) return 1;
			return 0;
		}
		function isIpv4(text) {
			if (typeof text !== "string") return false;
			const parts = text.split(".");
			if (parts.length !== 4) return false;
			for (const part of parts) {
				if (!/^\d{1,3}$/.test(part)) return false;
				if (Number(part) > 255) return false;
			}
			return true;
		}
		function parseServerList(text) {
			return String(text === null || text === undefined ? "" : text)
				.split(/[\s,;]+/)
				.map((item) => item.trim())
				.filter((item) => item.length > 0);
		}
		function errorsOf(section) {
			return asArray(asObject(section).errors).filter((entry) => typeof entry === "string" && entry.length > 0);
		}
		function safeErrorText(error) {
			if (error === null || error === undefined) return "";
			if (typeof error === "string") return error;
			if (typeof error.message === "string") return error.message;
			try {
				return String(error);
			} catch (_error) {
				return "";
			}
		}
		function pushSample(buffer, value, max) {
			if (!isFiniteNumber(value)) return;
			buffer.push(value);
			if (buffer.length > max) buffer.splice(0, buffer.length - max);
		}

		// ------------------------------------------------------------------
		// Dictionaries. `zh` and `en` carry identical key sets (checked by the
		// build-time dictionary test); every visible string goes through `t()`.
		// ------------------------------------------------------------------
		const zh = {
			panel: "设备",
			"tab.overview": "总览",
			"tab.hardware": "硬件",
			"tab.system": "系统",
			"tab.software": "软件",
			"tab.network": "网络",
			"tab.security": "安全",
			"tab.processes": "进程",
			"tab.actions": "操作",

			"header.connecting": "正在连接",
			"header.live": "实时",
			"header.stale": "连接中断",
			"header.offline": "离线",
			"header.updated": "更新于 {time}",
			"header.refresh": "刷新",
			"header.refreshing": "正在刷新…",
			"header.motionOn": "开启 3D 动效",
			"header.motionOff": "暂停 3D 动效",
			"header.uptime": "运行时长",

			"common.retry": "重试",
			"common.cancel": "取消",
			"common.confirm": "确认",
			"common.close": "关闭",
			"common.loading": "加载中…",
			"common.empty": "暂无数据",
			"common.error": "加载失败",
			"common.unknown": "未知",
			"common.na": "—",
			"common.search": "搜索",
			"common.all": "全部",
			"common.name": "名称",
			"common.value": "值",
			"common.status": "状态",
			"common.type": "类型",
			"common.size": "大小",
			"common.usage": "使用率",
			"common.total": "总计",
			"common.used": "已用",
			"common.free": "可用",
			"common.temperature": "温度",
			"common.updated": "已更新",
			"common.none": "无",
			"common.on": "开",
			"common.off": "关",
			"common.yes": "是",
			"common.no": "否",
			"common.enabled": "已启用",
			"common.disabled": "已停用",
			"common.pending": "处理中…",
			"common.refresh": "刷新",
			"common.admin": "管理员",
			"common.never": "从不",
			"common.notAvailable": "不可用",
			"common.percent": "百分比",
			"common.count": "数量",
			"common.version": "版本",
			"common.path": "路径",
			"common.model": "型号",
			"common.serial": "序列号",
			"common.user": "用户",
			"common.pid": "PID",
			"common.process": "进程",
			"common.port": "端口",
			"common.address": "地址",
			"common.source": "来源",
			"common.state": "状态",
			"common.load": "负载",
			"common.detail": "详情",
			"common.battery": "电池",
			"common.wifi": "Wi-Fi",
			"common.cpu": "CPU",
			"common.memory": "内存",
			"common.disk": "磁盘",
			"common.gpu": "GPU",
			"common.current": "当前",
			"common.actions": "操作",
			"common.cancelConfirm": "取消",

			"unit.day": "天",
			"unit.hour": "小时",
			"unit.minute": "分钟",
			"unit.lessThanMinute": "不到 1 分钟",
			"overview.kpi.cpu": "处理器",
			"overview.kpi.memory": "内存",
			"overview.kpi.disk": "磁盘",
			"overview.kpi.battery": "电池",
			"overview.kpi.network": "网络",
			"overview.kpi.load": "负载",
			"overview.kpi.pressure": "内存压力",
			"overview.kpi.cores": "{n} 个核心",
			"overview.kpi.free": "可用 {value}",
			"overview.kpi.used": "已用 {value}",
			"overview.kpi.remaining": "剩余 {value}",
			"overview.kpi.charging": "充电中",
			"overview.kpi.plugged": "已接入电源",
			"overview.kpi.onBattery": "使用电池",
			"overview.kpi.noBattery": "无电池",
			"overview.kpi.rx": "↓ {value}",
			"overview.kpi.tx": "↑ {value}",
			"overview.kpi.swap": "交换空间 {value}",
			"overview.sparkline.cpu": "处理器使用率趋势",
			"overview.sparkline.memory": "内存使用率趋势",
			"overview.sparkline.network": "网络吞吐趋势",
			"overview.alerts": "提醒",
			"overview.alerts.none": "一切正常，没有异常提醒",
			"overview.alert.memoryHigh": "内存使用率 {percent}，超过 85%",
			"overview.alert.cpuHigh": "处理器使用率 {percent}，持续偏高",
			"overview.alert.diskHigh": "磁盘空间紧张，已用 {percent}",
			"overview.alert.batteryLow": "电量偏低（{percent}）",
			"overview.alert.memoryPressure": "内存压力：{level}",
			"overview.alert.swap": "正在使用交换空间 {value}",
			"overview.alert.thermal": "处理器温度 {temp}°C",
			"overview.top": "高占用进程",
			"overview.top.empty": "暂无进程数据",
			"overview.memoryBreakdown": "内存构成",
			"overview.breakdown.app": "应用内存",
			"overview.breakdown.wired": "联动内存",
			"overview.breakdown.compressed": "压缩内存",
			"overview.breakdown.cached": "文件缓存",
			"overview.breakdown.free": "空闲",
			"overview.memPressure.normal": "正常",
			"overview.memPressure.warning": "偏高",
			"overview.memPressure.critical": "紧张",
			"overview.heroCaption": "实时设备核心",

			"hw.cpu": "处理器",
			"hw.cpuCore": "每核心使用率",
			"hw.memory": "内存",
			"hw.memoryModules": "内存模块",
			"hw.gpu": "图形处理器",
			"hw.displays": "显示器",
			"hw.storage": "存储",
			"hw.drives": "物理磁盘",
			"hw.volumes": "宗卷",
			"hw.battery": "电池健康",
			"hw.usb": "USB 设备",
			"hw.bluetooth": "蓝牙",
			"hw.audio": "音频设备",
			"hw.cameras": "摄像头",
			"hw.cores": "核心",
			"hw.physical": "物理核心",
			"hw.logical": "逻辑核心",
			"hw.speed": "主频",
			"hw.arch": "架构",
			"hw.vendor": "厂商",
			"hw.features": "指令集",
			"hw.slot": "插槽",
			"hw.manufacturer": "制造商",
			"hw.partNumber": "部件号",
			"hw.mediaType": "介质类型",
			"hw.smart": "SMART 状态",
			"hw.mount": "挂载点",
			"hw.fs": "文件系统",
			"hw.removable": "可移除",
			"hw.internal": "内置",
			"hw.condition": "电池状况",
			"hw.cycles": "循环次数",
			"hw.health": "健康度",
			"hw.designCapacity": "设计容量",
			"hw.maxCapacity": "最大容量",
			"hw.connection": "连接方式",
			"hw.refreshRate": "刷新率",
			"hw.main": "主显示器",
			"hw.connected": "已连接",
			"hw.notConnected": "未连接",
			"hw.chipset": "芯片组",
			"hw.firmware": "固件",
			"hw.controller": "控制器",
			"hw.devices": "设备",
			"hw.default": "默认",
			"hw.kind": "种类",
			"hw.output": "输出",
			"hw.input": "输入",
			"hw.modelId": "型号标识",
			"hw.uniqueId": "唯一标识",
			"hw.empty": "未发现设备",
			"hw.gpuCores": "{n} 个核心",
			"hw.vram": "显存",
			"hw.metal": "Metal",
			"hw.batteryPercent": "电量 {percent}",
			"hw.usbSpeed": "速率",
			"hw.bus": "总线",
			"hw.noModules": "没有内存模块信息",
			"hw.batteryNoData": "暂无电池信息",
			"hw.errors": "部分硬件信息不可用",

			"sys.os": "操作系统",
			"sys.device": "设备信息",
			"sys.boot": "启动与运行",
			"sys.users": "用户账户",
			"sys.currentUser": "当前用户",
			"sys.launchAgents": "启动代理",
			"sys.loginItems": "登录项",
			"sys.environment": "环境变量",
			"sys.locale": "区域设置",
			"sys.hostname": "主机名",
			"sys.computerName": "电脑名称",
			"sys.localHostname": "本地主机名",
			"sys.model": "机型",
			"sys.modelId": "型号标识",
			"sys.chip": "芯片",
			"sys.serial": "序列号",
			"sys.hardwareUuid": "硬件 UUID",
			"sys.name": "产品名称",
			"sys.version": "版本",
			"sys.build": "构建号",
			"sys.kernel": "内核",
			"sys.arch": "架构",
			"sys.bootTime": "启动时间",
			"sys.uptime": "已运行",
			"sys.uid": "UID",
			"sys.gid": "GID",
			"sys.home": "主目录",
			"sys.shell": "默认 Shell",
			"sys.fullName": "全名",
			"sys.adminRole": "管理员",
			"sys.totalUsers": "用户总数",
			"sys.scope": "作用域",
			"sys.loaded": "已加载",
			"sys.unloaded": "未加载",
			"sys.lastExit": "退出码",
			"sys.program": "程序",
			"sys.enableAgent": "启用",
			"sys.disableAgent": "停用",
			"sys.agentConfirmEnable": "启用启动代理 {label}？登录时将自动运行。",
			"sys.agentConfirmDisable": "停用启动代理 {label}？",
			"sys.noAgents": "未发现启动代理",
			"sys.noLoginItems": "未发现登录项",
			"sys.timezone": "时区",
			"sys.language": "语言",
			"sys.localeValue": "区域",
			"sys.envNote": "仅显示安全的非敏感变量",
			"sys.userScope": "用户",
			"sys.systemScope": "系统",
			"sys.errors": "部分系统信息不可用",

			"sw.applications": "应用程序",
			"sw.appCount": "共 {n} 个应用",
			"sw.search": "搜索应用…",
			"sw.sortName": "按名称排序",
			"sw.sortAsc": "名称升序",
			"sw.sortDesc": "名称降序",
			"sw.sourceFilter": "来源筛选",
			"sw.source.system": "系统",
			"sw.source.user": "用户",
			"sw.source.other": "其他",
			"sw.reveal": "在访达中显示",
			"sw.uninstall": "卸载…",
			"sw.uninstallTitle": "卸载 {name}？",
			"sw.uninstallBody": "应用会移入废纸篓，之后可以随时恢复。",
			"sw.bundleId": "Bundle ID",
			"sw.arch": "架构",
			"sw.lastUsed": "最近使用",
			"sw.homebrew": "Homebrew",
			"sw.brewInstalled": "已安装",
			"sw.brewOutdated": "可升级",
			"sw.brewNotAvailable": "未检测到 Homebrew",
			"sw.brewUninstall": "卸载…",
			"sw.brewConfirmTitle": "卸载 Homebrew 包 {name}？",
			"sw.brewConfirmBody": "该操作会移除 {name} 及其依赖，可能需要重新安装。",
			"sw.noApps": "没有匹配的应用",
			"sw.noBrew": "没有已安装的 Homebrew 包",
			"sw.loadingApps": "正在读取应用列表…",
			"sw.systemAppNote": "系统应用不可卸载",
			"sw.size": "大小",
			"sw.errors": "部分软件信息不可用",

			"net.interfaces": "网络接口",
			"net.wifi": "Wi-Fi",
			"net.route": "默认路由",
			"net.dns": "DNS",
			"net.proxy": "代理",
			"net.ports": "监听端口",
			"net.established": "已建立连接",
			"net.establishedCount": "{n} 个",
			"net.notConnected": "未连接 Wi-Fi",
			"net.ssid": "网络名称",
			"net.bssid": "BSSID",
			"net.rssi": "信号强度",
			"net.signalLevel": "信号 {level}/4",
			"net.noise": "噪声",
			"net.channel": "信道",
			"net.security": "安全",
			"net.txRate": "发送速率",
			"net.ipv4": "IPv4",
			"net.ipv6": "IPv6",
			"net.mac": "MAC 地址",
			"net.mtu": "MTU",
			"net.interface": "接口",
			"net.up": "已启用",
			"net.down": "已停用",
			"net.primary": "主接口",
			"net.gateway": "网关",
			"net.servers": "DNS 服务器",
			"net.searchDomains": "搜索域",
			"net.http": "HTTP",
			"net.https": "HTTPS",
			"net.socks": "SOCKS",
			"net.none": "未设置",
			"net.proto": "协议",
			"net.wifiPowerOn": "关闭 Wi-Fi",
			"net.wifiPowerOff": "开启 Wi-Fi",
			"net.setDns": "设置 DNS…",
			"net.openSettings": "打开网络设置",
			"net.dnsTitle": "设置 DNS",
			"net.dnsBody": "为网络服务 {service} 指定最多 4 个 DNS 服务器，留空表示自动获取。",
			"net.dnsService": "网络服务",
			"net.dnsServers": "DNS 服务器",
			"net.dnsServersPlaceholder": "每行一个，例如 1.1.1.1",
			"net.dnsInvalid": "请输入 0–4 个有效的 IPv4 地址",
			"net.dnsApplied": "DNS 已更新：{service}",
			"net.wifiOn": "Wi-Fi 已开启",
			"net.wifiOff": "Wi-Fi 已关闭",
			"net.confirmWifiOff": "关闭 Wi-Fi？",
			"net.confirmWifiOn": "开启 Wi-Fi？",
			"net.noInterfaces": "未发现网络接口",
			"net.noPorts": "没有监听端口",
			"net.type.wifi": "Wi-Fi",
			"net.type.ethernet": "以太网",
			"net.type.loopback": "回环",
			"net.type.bridge": "网桥",
			"net.type.other": "其他",
			"net.ipNone": "未分配",
			"net.errors": "部分网络信息不可用",

			"sec.fileVault": "文件保险箱",
			"sec.sip": "系统完整性保护",
			"sec.gatekeeper": "Gatekeeper",
			"sec.firewall": "防火墙",
			"sec.tcc": "隐私权限",
			"sec.admins": "管理员账户",
			"sec.remoteLogin": "远程登录",
			"sec.autoLogin": "自动登录",
			"sec.on": "已开启",
			"sec.off": "已关闭",
			"sec.unknown": "未知",
			"sec.stealth": "隐身模式",
			"sec.paneTitle": "系统设置面板",
			"sec.openFileVault": "打开文件保险箱设置",
			"sec.openFirewall": "打开防火墙设置",
			"sec.openSharing": "打开共享设置",
			"sec.openUsers": "打开用户与群组",
			"sec.flushDns": "清空 DNS 缓存",
			"sec.emptyTrash": "清空废纸篓",
			"sec.toggleFirewallOff": "关闭防火墙",
			"sec.toggleFirewallOn": "开启防火墙",
			"sec.confirmFlushDns": "清空 DNS 缓存？",
			"sec.confirmFlushDnsBody": "系统缓存将被清除，正在进行的解析可能会短暂重试。",
			"sec.confirmEmptyTrash": "清空废纸篓？",
			"sec.confirmEmptyTrashBody": "废纸篓中的项目将被永久删除，无法恢复。",
			"sec.confirmFirewallOff": "关闭防火墙？",
			"sec.confirmFirewallOffBody": "这会降低网络防护，请仅在确认需要时操作。",
			"sec.confirmFirewallOn": "开启防火墙？",
			"sec.confirmFirewallOnBody": "将启用 macOS 内置防火墙。",
			"sec.tccReadable": "以下应用拥有这些权限",
			"sec.tccUnreadable": "无法读取隐私权限数据库（需要完全磁盘访问权限）。",
			"sec.tccReason": "原因：{reason}",
			"sec.service": "权限",
			"sec.client": "应用",
			"sec.noGrants": "没有可显示的权限记录",
			"sec.remoteLoginOn": "远程登录已开启",
			"sec.remoteLoginOff": "远程登录已关闭",
			"sec.autoLoginOff": "未开启自动登录",
			"sec.autoLoginUser": "自动登录：{user}",
			"sec.adminsCount": "{n} 个管理员",
			"sec.usersCount": "共 {n} 个用户",
			"sec.noAdmins": "未发现管理员账户",
			"sec.errors": "部分安全信息不可用",

			"proc.search": "搜索进程…",
			"proc.total": "共 {n} 个进程",
			"proc.kill": "结束…",
			"proc.signal": "信号",
			"proc.confirmTitle": "结束进程 {name}？",
			"proc.confirmBody": "进程 {name}（PID {pid}）将收到 {signal} 信号。",
			"proc.sortByCpu": "按 CPU 排序",
			"proc.sortDesc": "降序",
			"proc.sortAsc": "升序",
			"proc.empty": "没有匹配的进程",
			"proc.refresh": "刷新进程",
			"proc.rss": "内存占用",
			"proc.elapsed": "运行时长",
			"proc.ppid": "PPID",
			"proc.command": "命令行",
			"proc.byUser": "按用户统计",
			"proc.signal.TERM": "终止 (TERM)",
			"proc.signal.KILL": "强制终止 (KILL)",
			"proc.signal.INT": "中断 (INT)",
			"proc.signal.STOP": "暂停 (STOP)",
			"proc.signal.CONT": "继续 (CONT)",
			"proc.errors": "部分进程信息不可用",

			"act.catalog": "操作目录",
			"act.groups.process": "进程",
			"act.groups.app": "应用",
			"act.groups.system": "系统",
			"act.groups.network": "网络",
			"act.groups.software": "软件",
			"act.groups.power": "电源",
			"act.run": "执行",
			"act.runTitle": "执行 {action}？",
			"act.runBody": "将调用系统接口执行该操作，部分操作不可撤销。",
			"act.params": "参数",
			"act.noParams": "无需参数",
			"act.required": "必填",
			"act.requiresAdmin": "需要管理员权限",
			"act.history": "执行记录",
			"act.historyEmpty": "还没有执行记录",
			"act.historyOk": "成功",
			"act.historyFail": "失败",
			"act.danger.low": "低风险",
			"act.danger.medium": "中风险",
			"act.danger.high": "高风险",
			"act.pending": "执行中…",
			"act.resultOk": "操作完成",
			"act.resultFail": "操作失败",
			"act.empty": "该分组暂无可用操作",
			"act.param.pid": "PID",
			"act.param.signal": "信号",
			"act.param.name": "名称",
			"act.param.path": "路径",
			"act.param.mode": "方式",
			"act.param.kind": "类型",
			"act.param.value": "值",
			"act.param.percent": "音量",
			"act.param.enabled": "启用",
			"act.param.pane": "面板",
			"act.param.service": "网络服务",
			"act.param.servers": "DNS 服务器",
			"act.paramPlaceholder.pid": "进程 ID",
			"act.paramPlaceholder.name": "名称",
			"act.paramPlaceholder.path": "/Applications/Foo.app",
			"act.paramPlaceholder.value": "新的值",
			"act.paramPlaceholder.pane": "面板标识",
			"act.paramPlaceholder.service": "Wi-Fi",
			"act.paramPlaceholder.servers": "1.1.1.1, 8.8.8.8",
			"act.selectPlaceholder": "请选择…",
			"act.mode.trash": "移到废纸篓",
			"act.mode.delete": "永久删除",
			"act.kind.HostName": "主机名",
			"act.kind.ComputerName": "电脑名称",
			"act.kind.LocalHostName": "本地主机名",
			"act.invalidNumber": "请输入 {min}–{max} 之间的数字",
			"act.invalidRequired": "请填写 {name}",
			"act.invalidSelect": "请选择 {name}",
			"act.footerHint": "所有操作都通过受限的本地接口执行。",

			"action.process.signal": "向进程发送信号",
			"action.process.signal.desc": "向指定 PID 发送 TERM、KILL 等 Unix 信号。",
			"action.app.quit": "退出应用",
			"action.app.quit.desc": "请求指定应用正常退出。",
			"action.app.launch": "启动应用",
			"action.app.launch.desc": "通过应用路径打开应用。",
			"action.app.reveal": "在访达中显示",
			"action.app.reveal.desc": "在访达中定位应用的位置。",
			"action.app.uninstall": "卸载应用",
			"action.app.uninstall.desc": "把应用移入废纸篓或永久删除。",
			"action.system.setHostname": "修改主机名",
			"action.system.setHostname.desc": "设置主机名、电脑名称或本地主机名。",
			"action.system.setVolume": "调整音量",
			"action.system.setVolume.desc": "把输出音量设为 0–100。",
			"action.system.setDarkMode": "切换深色模式",
			"action.system.setDarkMode.desc": "开启或关闭系统深色外观。",
			"action.system.launchAgent": "管理启动代理",
			"action.system.launchAgent.desc": "载入或停用指定的 launchd 代理。",
			"action.system.openSettings": "打开系统设置",
			"action.system.openSettings.desc": "跳转到指定的系统设置面板。",
			"action.system.toggleFirewall": "切换防火墙",
			"action.system.toggleFirewall.desc": "开启或关闭 macOS 应用防火墙。",
			"action.system.flushDNS": "清空 DNS 缓存",
			"action.system.flushDNS.desc": "刷新系统 DNS 解析缓存。",
			"action.system.emptyTrash": "清空废纸篓",
			"action.system.emptyTrash.desc": "永久删除废纸篓中的所有项目。",
			"action.network.setWifiPower": "切换 Wi-Fi",
			"action.network.setWifiPower.desc": "开启或关闭 Wi-Fi 无线网络。",
			"action.network.setDns": "设置 DNS",
			"action.network.setDns.desc": "为网络服务指定 DNS 服务器。",
			"action.power.sleep": "进入睡眠",
			"action.power.sleep.desc": "让设备立即进入睡眠。",
			"action.power.lock": "锁定屏幕",
			"action.power.lock.desc": "立即锁定当前屏幕会话。",
			"action.software.brewUninstall": "卸载 Homebrew 包",
			"action.software.brewUninstall.desc": "通过 Homebrew 卸载指定软件包。",

			"dialog.title": "请确认",
			"dialog.details": "操作详情",

			"toast.dismiss": "关闭通知",
			"toast.ok": "操作完成",
			"toast.fail": "操作失败",
			"toast.action.ok": "{action} 已完成",
			"toast.action.fail": "{action} 失败",
			"error.title": "无法连接到设备服务",
			"error.body": "请确认 Device X 插件已安装并在当前 DSH 实例中运行，然后重试。",
			"error.section": "该区域加载失败",
			"error.sectionHint": "数据可能暂时不可用，可以重试。",
			"error.render": "页面组件渲染失败",
			"error.stale": "连接中断，当前显示上次获取的数据",
			"error.staleRetry": "重新连接",

			"guard.title": "这一块内容出错了",
			"guard.retry": "重新渲染",
			"loading.title": "正在连接设备服务…",

			"aria.tabs": "设备分区",
			"aria.status": "连接状态",
			"aria.close": "关闭弹窗",
			"aria.alert": "提醒",
			"aria.refresh": "刷新数据",
			"aria.motion": "3D 动效",
			"aria.signal": "选择信号",
			"aria.switch": "开关",
			"aria.wifiBars": "Wi-Fi 信号强度",
		};

		const en = {
			panel: "Device X",
			"tab.overview": "Overview",
			"tab.hardware": "Hardware",
			"tab.system": "System",
			"tab.software": "Software",
			"tab.network": "Network",
			"tab.security": "Security",
			"tab.processes": "Processes",
			"tab.actions": "Actions",

			"header.connecting": "Connecting",
			"header.live": "Live",
			"header.stale": "Disconnected",
			"header.offline": "Offline",
			"header.updated": "Updated {time}",
			"header.refresh": "Refresh",
			"header.refreshing": "Refreshing…",
			"header.motionOn": "Turn on 3D motion",
			"header.motionOff": "Pause 3D motion",
			"header.uptime": "Uptime",

			"common.retry": "Retry",
			"common.cancel": "Cancel",
			"common.confirm": "Confirm",
			"common.close": "Close",
			"common.loading": "Loading…",
			"common.empty": "No data",
			"common.error": "Failed to load",
			"common.unknown": "Unknown",
			"common.na": "—",
			"common.search": "Search",
			"common.all": "All",
			"common.name": "Name",
			"common.value": "Value",
			"common.status": "Status",
			"common.type": "Type",
			"common.size": "Size",
			"common.usage": "Usage",
			"common.total": "Total",
			"common.used": "Used",
			"common.free": "Free",
			"common.temperature": "Temperature",
			"common.updated": "Updated",
			"common.none": "None",
			"common.on": "On",
			"common.off": "Off",
			"common.yes": "Yes",
			"common.no": "No",
			"common.enabled": "Enabled",
			"common.disabled": "Disabled",
			"common.pending": "Working…",
			"common.refresh": "Refresh",
			"common.admin": "Admin",
			"common.never": "Never",
			"common.notAvailable": "Not available",
			"common.percent": "Percent",
			"common.count": "Count",
			"common.version": "Version",
			"common.path": "Path",
			"common.model": "Model",
			"common.serial": "Serial",
			"common.user": "User",
			"common.pid": "PID",
			"common.process": "Process",
			"common.port": "Port",
			"common.address": "Address",
			"common.source": "Source",
			"common.state": "State",
			"common.load": "Load",
			"common.detail": "Details",
			"common.battery": "Battery",
			"common.wifi": "Wi-Fi",
			"common.cpu": "CPU",
			"common.memory": "Memory",
			"common.disk": "Disk",
			"common.gpu": "GPU",
			"common.current": "Current",
			"common.actions": "Actions",
			"common.cancelConfirm": "Cancel",

			"unit.day": "d",
			"unit.hour": "h",
			"unit.minute": "min",
			"unit.lessThanMinute": "less than a minute",
			"overview.kpi.cpu": "Processor",
			"overview.kpi.memory": "Memory",
			"overview.kpi.disk": "Disk",
			"overview.kpi.battery": "Battery",
			"overview.kpi.network": "Network",
			"overview.kpi.load": "Load",
			"overview.kpi.pressure": "Memory pressure",
			"overview.kpi.cores": "{n} cores",
			"overview.kpi.free": "{value} free",
			"overview.kpi.used": "{value} used",
			"overview.kpi.remaining": "{value} left",
			"overview.kpi.charging": "Charging",
			"overview.kpi.plugged": "Plugged in",
			"overview.kpi.onBattery": "On battery",
			"overview.kpi.noBattery": "No battery",
			"overview.kpi.rx": "↓ {value}",
			"overview.kpi.tx": "↑ {value}",
			"overview.kpi.swap": "Swap {value}",
			"overview.sparkline.cpu": "CPU usage trend",
			"overview.sparkline.memory": "Memory usage trend",
			"overview.sparkline.network": "Network throughput trend",
			"overview.alerts": "Alerts",
			"overview.alerts.none": "All good — no alerts",
			"overview.alert.memoryHigh": "Memory usage is {percent}, above 85%",
			"overview.alert.cpuHigh": "CPU usage is {percent} and running high",
			"overview.alert.diskHigh": "Disk space is tight at {percent} used",
			"overview.alert.batteryLow": "Low battery ({percent})",
			"overview.alert.memoryPressure": "Memory pressure: {level}",
			"overview.alert.swap": "Swap in use: {value}",
			"overview.alert.thermal": "CPU temperature {temp}°C",
			"overview.top": "Top processes",
			"overview.top.empty": "No process data",
			"overview.memoryBreakdown": "Memory breakdown",
			"overview.breakdown.app": "App memory",
			"overview.breakdown.wired": "Wired memory",
			"overview.breakdown.compressed": "Compressed",
			"overview.breakdown.cached": "File cache",
			"overview.breakdown.free": "Free",
			"overview.memPressure.normal": "Normal",
			"overview.memPressure.warning": "Elevated",
			"overview.memPressure.critical": "Critical",
			"overview.heroCaption": "Live device core",

			"hw.cpu": "Processor",
			"hw.cpuCore": "Per-core usage",
			"hw.memory": "Memory",
			"hw.memoryModules": "Memory modules",
			"hw.gpu": "Graphics",
			"hw.displays": "Displays",
			"hw.storage": "Storage",
			"hw.drives": "Physical drives",
			"hw.volumes": "Volumes",
			"hw.battery": "Battery health",
			"hw.usb": "USB devices",
			"hw.bluetooth": "Bluetooth",
			"hw.audio": "Audio devices",
			"hw.cameras": "Cameras",
			"hw.cores": "Cores",
			"hw.physical": "Physical cores",
			"hw.logical": "Logical cores",
			"hw.speed": "Speed",
			"hw.arch": "Architecture",
			"hw.vendor": "Vendor",
			"hw.features": "Features",
			"hw.slot": "Slot",
			"hw.manufacturer": "Manufacturer",
			"hw.partNumber": "Part number",
			"hw.mediaType": "Media type",
			"hw.smart": "SMART status",
			"hw.mount": "Mount",
			"hw.fs": "Filesystem",
			"hw.removable": "Removable",
			"hw.internal": "Internal",
			"hw.condition": "Condition",
			"hw.cycles": "Cycle count",
			"hw.health": "Health",
			"hw.designCapacity": "Design capacity",
			"hw.maxCapacity": "Max capacity",
			"hw.connection": "Connection",
			"hw.refreshRate": "Refresh rate",
			"hw.main": "Main display",
			"hw.connected": "Connected",
			"hw.notConnected": "Not connected",
			"hw.chipset": "Chipset",
			"hw.firmware": "Firmware",
			"hw.controller": "Controller",
			"hw.devices": "Devices",
			"hw.default": "Default",
			"hw.kind": "Kind",
			"hw.output": "Output",
			"hw.input": "Input",
			"hw.modelId": "Model ID",
			"hw.uniqueId": "Unique ID",
			"hw.empty": "No devices found",
			"hw.gpuCores": "{n} cores",
			"hw.vram": "VRAM",
			"hw.metal": "Metal",
			"hw.batteryPercent": "{percent} charged",
			"hw.usbSpeed": "Speed",
			"hw.bus": "Bus",
			"hw.noModules": "No module information",
			"hw.batteryNoData": "No battery information",
			"hw.errors": "Some hardware information is unavailable",

			"sys.os": "Operating system",
			"sys.device": "Device",
			"sys.boot": "Boot & uptime",
			"sys.users": "User accounts",
			"sys.currentUser": "Current user",
			"sys.launchAgents": "Launch agents",
			"sys.loginItems": "Login items",
			"sys.environment": "Environment",
			"sys.locale": "Locale",
			"sys.hostname": "Hostname",
			"sys.computerName": "Computer name",
			"sys.localHostname": "Local hostname",
			"sys.model": "Model",
			"sys.modelId": "Model ID",
			"sys.chip": "Chip",
			"sys.serial": "Serial",
			"sys.hardwareUuid": "Hardware UUID",
			"sys.name": "Product name",
			"sys.version": "Version",
			"sys.build": "Build",
			"sys.kernel": "Kernel",
			"sys.arch": "Architecture",
			"sys.bootTime": "Boot time",
			"sys.uptime": "Uptime",
			"sys.uid": "UID",
			"sys.gid": "GID",
			"sys.home": "Home",
			"sys.shell": "Shell",
			"sys.fullName": "Full name",
			"sys.adminRole": "Administrator",
			"sys.totalUsers": "Total users",
			"sys.scope": "Scope",
			"sys.loaded": "Loaded",
			"sys.unloaded": "Not loaded",
			"sys.lastExit": "Exit status",
			"sys.program": "Program",
			"sys.enableAgent": "Enable",
			"sys.disableAgent": "Disable",
			"sys.agentConfirmEnable": "Enable launch agent {label}? It will start automatically at login.",
			"sys.agentConfirmDisable": "Disable launch agent {label}?",
			"sys.noAgents": "No launch agents found",
			"sys.noLoginItems": "No login items found",
			"sys.timezone": "Time zone",
			"sys.language": "Language",
			"sys.localeValue": "Locale",
			"sys.envNote": "Only safe, non-sensitive variables are shown",
			"sys.userScope": "User",
			"sys.systemScope": "System",
			"sys.errors": "Some system information is unavailable",

			"sw.applications": "Applications",
			"sw.appCount": "{n} applications",
			"sw.search": "Search applications…",
			"sw.sortName": "Sort by name",
			"sw.sortAsc": "Name A→Z",
			"sw.sortDesc": "Name Z→A",
			"sw.sourceFilter": "Source",
			"sw.source.system": "System",
			"sw.source.user": "User",
			"sw.source.other": "Other",
			"sw.reveal": "Reveal in Finder",
			"sw.uninstall": "Uninstall…",
			"sw.uninstallTitle": "Uninstall {name}?",
			"sw.uninstallBody": "The app will be moved to the Trash and can be restored at any time.",
			"sw.bundleId": "Bundle ID",
			"sw.arch": "Architecture",
			"sw.lastUsed": "Last used",
			"sw.homebrew": "Homebrew",
			"sw.brewInstalled": "Installed",
			"sw.brewOutdated": "Outdated",
			"sw.brewNotAvailable": "Homebrew not found",
			"sw.brewUninstall": "Uninstall…",
			"sw.brewConfirmTitle": "Uninstall Homebrew package {name}?",
			"sw.brewConfirmBody": "This removes {name} and its dependencies. It may need to be reinstalled later.",
			"sw.noApps": "No matching applications",
			"sw.noBrew": "No Homebrew packages installed",
			"sw.loadingApps": "Reading the application list…",
			"sw.systemAppNote": "System apps cannot be uninstalled",
			"sw.size": "Size",
			"sw.errors": "Some software information is unavailable",

			"net.interfaces": "Interfaces",
			"net.wifi": "Wi-Fi",
			"net.route": "Default route",
			"net.dns": "DNS",
			"net.proxy": "Proxy",
			"net.ports": "Listening ports",
			"net.established": "Established connections",
			"net.establishedCount": "{n}",
			"net.notConnected": "Wi-Fi not connected",
			"net.ssid": "Network name",
			"net.bssid": "BSSID",
			"net.rssi": "Signal",
			"net.signalLevel": "Signal {level}/4",
			"net.noise": "Noise",
			"net.channel": "Channel",
			"net.security": "Security",
			"net.txRate": "Tx rate",
			"net.ipv4": "IPv4",
			"net.ipv6": "IPv6",
			"net.mac": "MAC address",
			"net.mtu": "MTU",
			"net.interface": "Interface",
			"net.up": "Up",
			"net.down": "Down",
			"net.primary": "Primary",
			"net.gateway": "Gateway",
			"net.servers": "DNS servers",
			"net.searchDomains": "Search domains",
			"net.http": "HTTP",
			"net.https": "HTTPS",
			"net.socks": "SOCKS",
			"net.none": "Not set",
			"net.proto": "Protocol",
			"net.wifiPowerOn": "Turn Wi-Fi off",
			"net.wifiPowerOff": "Turn Wi-Fi on",
			"net.setDns": "Set DNS…",
			"net.openSettings": "Open Network Settings",
			"net.dnsTitle": "Set DNS",
			"net.dnsBody": "Set up to 4 DNS servers for {service}. Leave empty to use automatic DNS.",
			"net.dnsService": "Network service",
			"net.dnsServers": "DNS servers",
			"net.dnsServersPlaceholder": "One per line or comma separated, e.g. 1.1.1.1",
			"net.dnsInvalid": "Enter 0–4 valid IPv4 addresses",
			"net.dnsApplied": "DNS updated: {service}",
			"net.wifiOn": "Wi-Fi turned on",
			"net.wifiOff": "Wi-Fi turned off",
			"net.confirmWifiOff": "Turn Wi-Fi off?",
			"net.confirmWifiOn": "Turn Wi-Fi on?",
			"net.noInterfaces": "No network interfaces found",
			"net.noPorts": "No listening ports",
			"net.type.wifi": "Wi-Fi",
			"net.type.ethernet": "Ethernet",
			"net.type.loopback": "Loopback",
			"net.type.bridge": "Bridge",
			"net.type.other": "Other",
			"net.ipNone": "Unassigned",
			"net.errors": "Some network information is unavailable",

			"sec.fileVault": "FileVault",
			"sec.sip": "System Integrity Protection",
			"sec.gatekeeper": "Gatekeeper",
			"sec.firewall": "Firewall",
			"sec.tcc": "Privacy permissions",
			"sec.admins": "Admin accounts",
			"sec.remoteLogin": "Remote login",
			"sec.autoLogin": "Auto login",
			"sec.on": "On",
			"sec.off": "Off",
			"sec.unknown": "Unknown",
			"sec.stealth": "Stealth mode",
			"sec.paneTitle": "System Settings panes",
			"sec.openFileVault": "Open FileVault Settings",
			"sec.openFirewall": "Open Firewall Settings",
			"sec.openSharing": "Open Sharing Settings",
			"sec.openUsers": "Open Users & Groups",
			"sec.flushDns": "Flush DNS cache",
			"sec.emptyTrash": "Empty Trash",
			"sec.toggleFirewallOff": "Turn firewall off",
			"sec.toggleFirewallOn": "Turn firewall on",
			"sec.confirmFlushDns": "Flush the DNS cache?",
			"sec.confirmFlushDnsBody": "System caches will be cleared and in-flight lookups may retry briefly.",
			"sec.confirmEmptyTrash": "Empty the Trash?",
			"sec.confirmEmptyTrashBody": "Items in the Trash will be permanently deleted and cannot be recovered.",
			"sec.confirmFirewallOff": "Turn off the firewall?",
			"sec.confirmFirewallOffBody": "This weakens network protection. Only do it when you are sure.",
			"sec.confirmFirewallOn": "Turn on the firewall?",
			"sec.confirmFirewallOnBody": "This enables the built-in macOS firewall.",
			"sec.tccReadable": "These apps hold these permissions",
			"sec.tccUnreadable": "The privacy database cannot be read (Full Disk Access is required).",
			"sec.tccReason": "Reason: {reason}",
			"sec.service": "Permission",
			"sec.client": "App",
			"sec.noGrants": "No permission records to show",
			"sec.remoteLoginOn": "Remote login is on",
			"sec.remoteLoginOff": "Remote login is off",
			"sec.autoLoginOff": "Auto login is off",
			"sec.autoLoginUser": "Auto login: {user}",
			"sec.adminsCount": "{n} administrators",
			"sec.usersCount": "{n} users total",
			"sec.noAdmins": "No administrators found",
			"sec.errors": "Some security information is unavailable",

			"proc.search": "Search processes…",
			"proc.total": "{n} processes",
			"proc.kill": "End…",
			"proc.signal": "Signal",
			"proc.confirmTitle": "End process {name}?",
			"proc.confirmBody": "Process {name} (PID {pid}) will receive the {signal} signal.",
			"proc.sortByCpu": "Sort by CPU",
			"proc.sortDesc": "Descending",
			"proc.sortAsc": "Ascending",
			"proc.empty": "No matching processes",
			"proc.refresh": "Refresh processes",
			"proc.rss": "Memory",
			"proc.elapsed": "Elapsed",
			"proc.ppid": "PPID",
			"proc.command": "Command",
			"proc.byUser": "By user",
			"proc.signal.TERM": "Terminate (TERM)",
			"proc.signal.KILL": "Force kill (KILL)",
			"proc.signal.INT": "Interrupt (INT)",
			"proc.signal.STOP": "Suspend (STOP)",
			"proc.signal.CONT": "Resume (CONT)",
			"proc.errors": "Some process information is unavailable",

			"act.catalog": "Action catalog",
			"act.groups.process": "Processes",
			"act.groups.app": "Applications",
			"act.groups.system": "System",
			"act.groups.network": "Network",
			"act.groups.software": "Software",
			"act.groups.power": "Power",
			"act.run": "Run",
			"act.runTitle": "Run {action}?",
			"act.runBody": "This invokes system interfaces. Some actions cannot be undone.",
			"act.params": "Parameters",
			"act.noParams": "No parameters",
			"act.required": "Required",
			"act.requiresAdmin": "Requires admin",
			"act.history": "History",
			"act.historyEmpty": "No actions yet",
			"act.historyOk": "Succeeded",
			"act.historyFail": "Failed",
			"act.danger.low": "Low risk",
			"act.danger.medium": "Medium risk",
			"act.danger.high": "High risk",
			"act.pending": "Running…",
			"act.resultOk": "Action completed",
			"act.resultFail": "Action failed",
			"act.empty": "No actions in this group",
			"act.param.pid": "PID",
			"act.param.signal": "Signal",
			"act.param.name": "Name",
			"act.param.path": "Path",
			"act.param.mode": "Mode",
			"act.param.kind": "Type",
			"act.param.value": "Value",
			"act.param.percent": "Volume",
			"act.param.enabled": "Enabled",
			"act.param.pane": "Pane",
			"act.param.service": "Network service",
			"act.param.servers": "DNS servers",
			"act.paramPlaceholder.pid": "Process ID",
			"act.paramPlaceholder.name": "Name",
			"act.paramPlaceholder.path": "/Applications/Foo.app",
			"act.paramPlaceholder.value": "New value",
			"act.paramPlaceholder.pane": "Pane identifier",
			"act.paramPlaceholder.service": "Wi-Fi",
			"act.paramPlaceholder.servers": "1.1.1.1, 8.8.8.8",
			"act.selectPlaceholder": "Select…",
			"act.mode.trash": "Move to Trash",
			"act.mode.delete": "Delete permanently",
			"act.kind.HostName": "Host name",
			"act.kind.ComputerName": "Computer name",
			"act.kind.LocalHostName": "Local host name",
			"act.invalidNumber": "Enter a number between {min} and {max}",
			"act.invalidRequired": "Please fill in {name}",
			"act.invalidSelect": "Please choose {name}",
			"act.footerHint": "Every action goes through a restricted local API.",

			"action.process.signal": "Signal a process",
			"action.process.signal.desc": "Send a Unix signal such as TERM or KILL to a PID.",
			"action.app.quit": "Quit application",
			"action.app.quit.desc": "Ask the given application to quit gracefully.",
			"action.app.launch": "Launch application",
			"action.app.launch.desc": "Open an application by path.",
			"action.app.reveal": "Reveal in Finder",
			"action.app.reveal.desc": "Reveal an application's location in Finder.",
			"action.app.uninstall": "Uninstall application",
			"action.app.uninstall.desc": "Move an app to the Trash or delete it permanently.",
			"action.system.setHostname": "Set host name",
			"action.system.setHostname.desc": "Change the host name, computer name, or local host name.",
			"action.system.setVolume": "Set volume",
			"action.system.setVolume.desc": "Set the output volume from 0 to 100.",
			"action.system.setDarkMode": "Toggle dark mode",
			"action.system.setDarkMode.desc": "Turn the system dark appearance on or off.",
			"action.system.launchAgent": "Manage launch agent",
			"action.system.launchAgent.desc": "Load or unload a launchd agent plist.",
			"action.system.openSettings": "Open System Settings",
			"action.system.openSettings.desc": "Jump to a specific System Settings pane.",
			"action.system.toggleFirewall": "Toggle firewall",
			"action.system.toggleFirewall.desc": "Turn the macOS application firewall on or off.",
			"action.system.flushDNS": "Flush DNS cache",
			"action.system.flushDNS.desc": "Refresh the system DNS resolver cache.",
			"action.system.emptyTrash": "Empty Trash",
			"action.system.emptyTrash.desc": "Permanently delete everything in the Trash.",
			"action.network.setWifiPower": "Toggle Wi-Fi",
			"action.network.setWifiPower.desc": "Turn Wi-Fi power on or off.",
			"action.network.setDns": "Set DNS",
			"action.network.setDns.desc": "Assign DNS servers to a network service.",
			"action.power.sleep": "Sleep",
			"action.power.sleep.desc": "Put the device to sleep immediately.",
			"action.power.lock": "Lock screen",
			"action.power.lock.desc": "Lock the current screen session immediately.",
			"action.software.brewUninstall": "Uninstall Homebrew package",
			"action.software.brewUninstall.desc": "Remove a package through Homebrew.",

			"dialog.title": "Confirm",
			"dialog.details": "Details",

			"toast.dismiss": "Dismiss notification",
			"toast.ok": "Action completed",
			"toast.fail": "Action failed",
			"toast.action.ok": "{action} completed",
			"toast.action.fail": "{action} failed",
			"error.title": "Cannot reach the device service",
			"error.body": "Make sure the Device X plugin is installed and running in this DSH instance, then retry.",
			"error.section": "This section failed to load",
			"error.sectionHint": "The data may be temporarily unavailable. Try again.",
			"error.render": "A page widget failed to render",
			"error.stale": "Connection lost — showing the last known data",
			"error.staleRetry": "Reconnect",

			"guard.title": "This widget hit an error",
			"guard.retry": "Remount",
			"loading.title": "Connecting to the device service…",

			"aria.tabs": "Device sections",
			"aria.status": "Connection status",
			"aria.close": "Close dialog",
			"aria.alert": "Alerts",
			"aria.refresh": "Refresh data",
			"aria.motion": "3D motion",
			"aria.signal": "Choose a signal",
			"aria.switch": "Switch",
			"aria.wifiBars": "Wi-Fi signal strength",
		};

		// ------------------------------------------------------------------
		// Stylesheet. Registered as one disposable <style> element in <head>
		// (the shipped precedent) and removed on unload. Colors use only the
		// contract's theme tokens plus `color-mix()` derivatives; literal
		// colors appear exclusively inside the 3D artwork and the SVG charts.
		// ------------------------------------------------------------------
		const STYLE_TEXT = `
.dx-root {
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	position: relative;
	background: var(--dsw-alias-bg-base);
	color: var(--dsw-alias-label-primary);
	font-family: inherit;
	font-size: 13px;
	line-height: 1.5;
	-webkit-font-smoothing: antialiased;
}
.dx-root *, .dx-root *::before, .dx-root *::after { box-sizing: border-box; }
.dx-root button { font-family: inherit; }
.dx-root h1, .dx-root h2, .dx-root h3, .dx-root h4, .dx-root p { margin: 0; }
.dx-mono { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
.dx-num { font-variant-numeric: tabular-nums; text-align: right; }
.dx-muted { color: var(--dsw-alias-label-secondary); }
.dx-small { font-size: 11.5px; line-height: 1.45; }
.dx-grow { flex: 1 1 auto; min-width: 0; }
.dx-truncate { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------------------------------------------------------------- header */
.dx-header {
	flex: none;
	display: flex;
	align-items: flex-start;
	gap: 16px;
	padding: calc(20px + var(--dsh-frame-top-clearance, 0px)) clamp(20px, 4vw, 40px) 14px;
	border-bottom: 0.5px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-base) 86%, transparent);
	backdrop-filter: blur(14px);
	-webkit-backdrop-filter: blur(14px);
}
.dx-headerMain { flex: 1 1 auto; min-width: 0; }
.dx-titleRow { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dx-title {
	font-size: 20px; font-weight: 600; line-height: 28px; letter-spacing: -0.01em;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46vw;
}
.dx-osChip {
	flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 9px;
	border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-secondary);
	font-size: 11px; font-weight: 500; letter-spacing: 0.01em; white-space: nowrap;
}
.dx-headerMeta {
	display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
	margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.dx-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.dx-status[data-state="ready"] { color: var(--dsw-alias-state-success-primary); }
.dx-status[data-state="stale"] { color: var(--dsw-alias-state-warn-primary); }
.dx-status[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.dx-status[data-state="loading"] { color: var(--dsw-alias-label-secondary); }
.dx-statusDot {
	width: 7px; height: 7px; border-radius: 50%; flex: none;
	background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
}
.dx-status[data-state="loading"] .dx-statusDot { animation: dx-pulse 1.4s ease-in-out infinite; }
.dx-headerActions { flex: none; display: flex; align-items: center; gap: 8px; padding-top: 2px; }
.dx-iconBtn {
	width: 32px; height: 32px; padding: 0; border-radius: 8px; cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center;
	color: var(--dsw-alias-label-secondary);
	background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1);
	transition: color .16s ease, border-color .16s ease, background-color .16s ease;
}
.dx-iconBtn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dx-iconBtn:disabled { cursor: default; opacity: .55; }
.dx-iconBtn:focus-visible, .dx-pillBtn:focus-visible, .dx-btn:focus-visible,
.dx-railTab:focus-visible, .dx-segBtn:focus-visible, .dx-switch:focus-visible,
.dx-linkBtn:focus-visible, .dx-iconBtn:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px;
}
.dx-pillBtn {
	display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
	border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 500;
	color: var(--dsw-alias-label-secondary);
	background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1);
	transition: color .16s ease, border-color .16s ease, background-color .16s ease;
}
.dx-pillBtn[aria-pressed="true"] {
	color: var(--dsw-alias-brand-primary);
	border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1));
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1));
}
.dx-pillBtn:hover { border-color: var(--dsw-alias-border-l2); }
.dx-spin { animation: dx-spin 1s linear infinite; }

/* ------------------------------------------------------------------ body */
.dx-body {
	flex: 1 1 auto; min-height: 0; display: flex; gap: 20px;
	padding: 16px clamp(20px, 4vw, 40px) 20px;
}
.dx-rail {
	flex: none; width: 168px; display: flex; flex-direction: column; gap: 2px;
	padding-right: 16px; border-right: 0.5px solid var(--dsw-alias-border-l1);
	overflow-y: auto; scrollbar-width: thin;
	scrollbar-color: var(--dsw-alias-border-l2) transparent;
}
.dx-railTab {
	position: relative; display: flex; align-items: center; gap: 10px;
	height: 34px; padding: 0 10px; border: 0; border-radius: 8px;
	background: transparent; color: var(--dsw-alias-label-secondary);
	font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;
	transition: background-color .15s ease, color .15s ease;
}
.dx-railTab:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dx-railTab[aria-selected="true"] {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, var(--dsw-alias-bg-layer-1));
	color: var(--dsw-alias-brand-primary);
}
.dx-railTab[aria-selected="true"]::before {
	content: ""; position: absolute; left: -17px; top: 7px; bottom: 7px; width: 3px;
	border-radius: 0 3px 3px 0; background: var(--dsw-alias-brand-primary);
}
.dx-railIcon { flex: none; display: inline-flex; opacity: .9; }
.dx-railLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-contentWrap { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.dx-content {
	flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
	padding-right: 6px; scrollbar-width: thin;
	scrollbar-color: var(--dsw-alias-border-l2) transparent;
}
.dx-tabpanel { animation: dx-fadein .18s ease both; }

/* --------------------------------------------------------------- banners */
.dx-banner {
	display: flex; align-items: center; gap: 10px; padding: 9px 12px;
	border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
	font-size: 12px;
}
.dx-banner[data-tone="warn"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1)); }
.dx-banner[data-tone="error"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1)); }
.dx-bannerText { flex: 1 1 auto; min-width: 0; }
.dx-bannerIcon { flex: none; display: inline-flex; color: var(--dsw-alias-state-warn-primary); }
.dx-banner[data-tone="error"] .dx-bannerIcon { color: var(--dsw-alias-state-error-primary); }

/* ----------------------------------------------------------------- cards */
.dx-section { display: flex; flex-direction: column; gap: 14px; }
.dx-section + .dx-section { margin-top: 16px; }
.dx-sectionHead { display: flex; align-items: baseline; gap: 10px; }
.dx-sectionTitle { font-size: 14px; font-weight: 600; letter-spacing: -0.005em; }
.dx-sectionSub { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dx-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.dx-grid2 { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.dx-grid3 { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.dx-card {
	position: relative; min-width: 0; border-radius: 12px;
	background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1);
	padding: 14px 16px;
}
.dx-card[data-span="2"] { grid-column: span 2; }
.dx-cardHead { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.dx-cardHeadIcon {
	flex: none; width: 26px; height: 26px; border-radius: 7px;
	display: inline-flex; align-items: center; justify-content: center;
	color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.dx-cardTitles { min-width: 0; flex: 1 1 auto; }
.dx-cardTitle { font-size: 13px; font-weight: 600; }
.dx-cardSub { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-top: 1px; }
.dx-cardActions { flex: none; display: flex; align-items: center; gap: 6px; }
.dx-cardBody { min-width: 0; }
.dx-cardBodyFlush { margin: 0 -16px -14px; }

/* ------------------------------------------------------------------ hero */
.dx-heroCard {
	display: grid; grid-template-columns: minmax(240px, 340px) minmax(0, 1fr);
	gap: 22px; align-items: center; overflow: hidden; position: relative;
	border-radius: 14px; padding: 16px 18px;
	background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1);
}
.dx-heroInfo { min-width: 0; }
.dx-heroTitle {
	font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.015em;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dx-heroSub { color: var(--dsw-alias-label-secondary); font-size: 12.5px; margin-top: 4px; }
.dx-heroChips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.dx-chip {
	display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
	border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 60%, transparent);
	color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 500;
}
.dx-chip strong { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.dx-chip[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, var(--dsw-alias-border-l1)); }
.dx-chip[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, var(--dsw-alias-border-l1)); }
.dx-chip[data-tone="error"] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1)); }

/* The 3D device core: pure CSS transforms, artwork colors are intentional. */
.dx-scene {
	position: relative; height: 216px; border-radius: 12px; overflow: hidden;
	perspective: 900px; perspective-origin: 50% 42%;
	background:
		radial-gradient(120% 150% at 50% -10%, #1e2a5e 0%, #0c1228 52%, #070a15 100%);
	border: 1px solid #26315f;
	isolation: isolate;
}
.dx-sceneGlow {
	position: absolute; inset: -30% -20% auto -20%; height: 80%;
	background: radial-gradient(50% 50% at 50% 50%, rgba(97, 122, 255, .38) 0%, rgba(56, 189, 248, .12) 45%, transparent 72%);
	filter: blur(6px); pointer-events: none;
}
.dx-sceneGrid {
	position: absolute; left: -40%; right: -40%; bottom: -30%; height: 78%;
	background-image:
		linear-gradient(rgba(86, 145, 255, .22) 1px, transparent 1px),
		linear-gradient(90deg, rgba(86, 145, 255, .22) 1px, transparent 1px);
	background-size: 34px 34px;
	transform: rotateX(62deg);
	transform-origin: 50% 100%;
	mask-image: linear-gradient(to top, rgba(0,0,0,.85), transparent 78%);
	-webkit-mask-image: linear-gradient(to top, rgba(0,0,0,.85), transparent 78%);
	pointer-events: none;
}
.dx-orbit { position: absolute; inset: 0; transform-style: preserve-3d; animation: dx-orbit 26s linear infinite; }
.dx-orbit[data-layer="2"] { animation-duration: 34s; animation-direction: reverse; }
.dx-orbit[data-layer="3"] { animation-duration: 18s; }
.dx-ring {
	position: absolute; left: 50%; top: 50%; width: 168px; height: 168px; margin: -84px 0 0 -84px;
	border-radius: 50%; border: 1px solid rgba(124, 92, 255, .55);
	box-shadow: 0 0 26px rgba(124, 92, 255, .28), inset 0 0 26px rgba(124, 92, 255, .12);
	transform: rotateX(74deg);
}
.dx-ring[data-ring="2"] {
	width: 218px; height: 218px; margin: -109px 0 0 -109px;
	border-color: rgba(56, 189, 248, .5);
	box-shadow: 0 0 28px rgba(56, 189, 248, .22), inset 0 0 28px rgba(56, 189, 248, .1);
	transform: rotateX(64deg) rotateY(18deg);
}
.dx-ring[data-ring="3"] {
	width: 128px; height: 128px; margin: -64px 0 0 -64px;
	border-style: dashed; border-color: rgba(34, 211, 238, .4);
	transform: rotateX(80deg) rotateZ(30deg);
}
.dx-ring[data-ring="2"]::after {
	content: ""; position: absolute; top: 50%; left: -4px; width: 8px; height: 8px;
	margin-top: -4px; border-radius: 50%; background: #67e8f9;
	box-shadow: 0 0 14px #22d3ee, 0 0 34px rgba(34, 211, 238, .55);
}
.dx-chipScene { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform-style: preserve-3d; animation: dx-float 7s ease-in-out infinite; }
.dx-chipBody {
	position: relative; width: 116px; height: 116px; border-radius: 16px;
	transform: rotateX(52deg) rotateZ(-38deg);
	background:
		linear-gradient(145deg, #2a3a76 0%, #131b3c 46%, #0d1330 100%);
	border: 1px solid #4f63aa;
	box-shadow:
		0 0 0 1px rgba(56, 189, 248, .18),
		0 26px 54px rgba(4, 8, 20, .78),
		inset 0 0 30px rgba(78, 110, 255, .34);
}
.dx-chipBody::before {
	content: ""; position: absolute; inset: 13px; border-radius: 9px;
	background-image:
		linear-gradient(rgba(124, 92, 255, .34) 1px, transparent 1px),
		linear-gradient(90deg, rgba(124, 92, 255, .34) 1px, transparent 1px);
	background-size: 13px 13px;
	border: 1px solid rgba(124, 92, 255, .28);
}
.dx-chipCore {
	position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
	border-radius: 10px;
	background: radial-gradient(circle at 38% 32%, #bff3ff 0%, #38bdf8 36%, #6366f1 78%, #4338ca 100%);
	box-shadow: 0 0 18px rgba(56, 189, 248, .75), 0 0 44px rgba(99, 102, 241, .5);
	animation: dx-corePulse 3.2s ease-in-out infinite;
}
.dx-chipCore::after {
	content: ""; position: absolute; inset: 9px; border-radius: 6px;
	border: 1px solid rgba(255, 255, 255, .55);
}
.dx-chipPins { position: absolute; inset: -7px; border-radius: 20px; pointer-events: none; }
.dx-chipPins span { position: absolute; background: #5f74bd; border-radius: 1px; }
.dx-chipPins span:nth-child(1), .dx-chipPins span:nth-child(2), .dx-chipPins span:nth-child(3), .dx-chipPins span:nth-child(4), .dx-chipPins span:nth-child(5), .dx-chipPins span:nth-child(6) {
	width: 5px; height: 12px; top: -6px;
}
.dx-chipPins span:nth-child(1) { left: 18px; }
.dx-chipPins span:nth-child(2) { left: 38px; }
.dx-chipPins span:nth-child(3) { left: 58px; }
.dx-chipPins span:nth-child(4) { left: 78px; }
.dx-chipPins span:nth-child(5) { left: 98px; }
.dx-chipPins span:nth-child(6) { left: 118px; }
.dx-chipPins span:nth-child(7), .dx-chipPins span:nth-child(8), .dx-chipPins span:nth-child(9), .dx-chipPins span:nth-child(10), .dx-chipPins span:nth-child(11), .dx-chipPins span:nth-child(12) {
	width: 5px; height: 12px; bottom: -6px;
}
.dx-chipPins span:nth-child(7) { left: 18px; }
.dx-chipPins span:nth-child(8) { left: 38px; }
.dx-chipPins span:nth-child(9) { left: 58px; }
.dx-chipPins span:nth-child(10) { left: 78px; }
.dx-chipPins span:nth-child(11) { left: 98px; }
.dx-chipPins span:nth-child(12) { left: 118px; }
.dx-particle {
	position: absolute; width: 4px; height: 4px; border-radius: 50%;
	background: #67e8f9; box-shadow: 0 0 10px rgba(34, 211, 238, .9);
	animation: dx-drift 9s ease-in-out infinite;
}
.dx-particle[data-p="1"] { left: 16%; top: 30%; animation-delay: -1s; }
.dx-particle[data-p="2"] { left: 78%; top: 24%; width: 3px; height: 3px; background: #a78bfa; box-shadow: 0 0 10px rgba(167, 139, 250, .9); animation-delay: -3s; }
.dx-particle[data-p="3"] { left: 68%; top: 74%; animation-delay: -5s; }
.dx-particle[data-p="4"] { left: 24%; top: 70%; width: 3px; height: 3px; background: #a78bfa; box-shadow: 0 0 10px rgba(167, 139, 250, .9); animation-delay: -7s; }
.dx-sceneCaption {
	position: absolute; left: 12px; bottom: 10px;
	color: rgba(196, 212, 255, .72); font-size: 10px; font-weight: 600;
	letter-spacing: .14em; text-transform: uppercase;
}
.dx-root[data-motion="off"] .dx-scene *,
.dx-root[data-motion="off"] .dx-scene { animation-play-state: paused !important; }

/* ------------------------------------------------------------------- KPIs */
.dx-kpiGrid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(196px, 1fr)); }
.dx-kpi {
	display: flex; flex-direction: column; gap: 10px; min-width: 0;
	border-radius: 12px; padding: 14px 14px 11px;
	background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
	transition: border-color .18s ease;
}
.dx-kpi:hover { border-color: var(--dsw-alias-border-l2); }
.dx-kpiTop { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dx-donutWrap { position: relative; flex: none; width: 62px; height: 62px; }
.dx-donutCenter {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.dx-kpiMeta { min-width: 0; flex: 1 1 auto; }
.dx-kpiLabel { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 500; }
.dx-kpiValue { font-size: 19px; font-weight: 600; line-height: 1.25; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dx-kpiSub { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dx-kpiSpark { height: 26px; }
.dx-spark { display: block; width: 100%; height: 26px; }
.dx-sparkEmpty { border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-border-l1) 45%, transparent); height: 1px; margin-top: 12px; }

/* ------------------------------------------------------------- list rows */
.dx-list { display: flex; flex-direction: column; }
.dx-listRow {
	display: flex; align-items: center; gap: 10px; min-width: 0;
	padding: 7px 2px; border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dx-listRow:first-child { border-top: none; }
.dx-listRank { flex: none; width: 18px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dx-listPrimary { min-width: 0; flex: 1 1 auto; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-listSecondary { color: var(--dsw-alias-label-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-listRight { flex: none; display: flex; align-items: center; gap: 10px; font-variant-numeric: tabular-nums; font-size: 12px; }
.dx-listRight span { min-width: 52px; text-align: right; }

/* ------------------------------------------------------------- alerts etc */
.dx-alertList { display: flex; flex-direction: column; gap: 6px; }
.dx-alert {
	display: flex; align-items: center; gap: 9px; padding: 8px 11px;
	border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent);
	font-size: 12px;
}
.dx-alert[data-tone="warn"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-border-l1)); }
.dx-alert[data-tone="error"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l1)); }
.dx-alert[data-tone="idle"] { color: var(--dsw-alias-label-secondary); }
.dx-alertIcon { flex: none; display: inline-flex; color: var(--dsw-alias-state-warn-primary); }
.dx-alert[data-tone="error"] .dx-alertIcon { color: var(--dsw-alias-state-error-primary); }
.dx-alert[data-tone="idle"] .dx-alertIcon { color: var(--dsw-alias-state-success-primary); }
.dx-alertText { min-width: 0; }

.dx-bars { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
.dx-barRow { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dx-barHead { display: flex; justify-content: space-between; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; font-variant-numeric: tabular-nums; }
.dx-barTrack { height: 5px; border-radius: 3px; background: var(--dsw-alias-border-l1); overflow: hidden; }
.dx-barFill { height: 100%; border-radius: 3px; transition: width .5s ease; }

.dx-stackBar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--dsw-alias-border-l1); }
.dx-stackSeg { height: 100%; transition: width .5s ease; }
.dx-legend { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; }
.dx-legendRow { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
.dx-legendDot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
.dx-legendLabel { flex: 1 1 auto; color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-legendValue { font-variant-numeric: tabular-nums; }

/* ------------------------------------------------------------------ facts */
.dx-factGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px 16px; }
.dx-fact { min-width: 0; }
.dx-factLabel { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dx-factValue { font-weight: 500; overflow-wrap: anywhere; }
.dx-fact[data-wide="true"] { grid-column: 1 / -1; }

/* ----------------------------------------------------------------- tables */
.dx-tableWrap { overflow: auto; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); }
.dx-cardBodyFlush .dx-tableWrap { border: none; border-radius: 0 0 12px 12px; }
.dx-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.dx-table th, .dx-table td { text-align: left; padding: 8px 12px; vertical-align: middle; }
.dx-table thead th {
	position: sticky; top: 0; z-index: 1; white-space: nowrap;
	background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
	font-size: 11px; font-weight: 600; letter-spacing: .01em;
	border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.dx-table tbody tr { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dx-table tbody tr:first-child { border-top: none; }
.dx-table tbody tr:hover { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent); }
.dx-table td { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-table td.dx-tdWrap { white-space: normal; overflow-wrap: anywhere; }
.dx-rowActions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

/* ------------------------------------------------------------------- pills */
.dx-pill {
	display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px;
	border-radius: 999px; font-size: 10.5px; font-weight: 600; letter-spacing: .01em;
	border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-2);
	color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dx-pill[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); }
.dx-pill[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent); }
.dx-pill[data-tone="error"] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.dx-pill[data-tone="brand"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
.dx-pill[data-tone="idle"] { color: var(--dsw-alias-label-secondary); }

/* ----------------------------------------------------------------- buttons */
.dx-btn {
	display: inline-flex; align-items: center; justify-content: center; gap: 6px;
	height: 30px; padding: 0 12px; border-radius: 8px; cursor: pointer;
	font-size: 12px; font-weight: 500; white-space: nowrap;
	color: var(--dsw-alias-label-primary);
	background: var(--dsw-alias-bg-layer-2);
	border: 1px solid var(--dsw-alias-border-l1);
	transition: border-color .15s ease, background-color .15s ease, color .15s ease;
}
.dx-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dx-btn:disabled { cursor: default; opacity: .55; }
.dx-btn[data-variant="primary"] {
	color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1));
	border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-border-l1));
}
.dx-btn[data-variant="danger"] {
	color: var(--dsw-alias-state-error-primary);
	background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, var(--dsw-alias-bg-layer-1));
	border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1));
}
.dx-btn[data-size="sm"] { height: 26px; padding: 0 9px; font-size: 11.5px; border-radius: 7px; }
.dx-btn[data-size="icon"] { width: 28px; height: 28px; padding: 0; border-radius: 7px; }
.dx-btn[data-block="true"] { width: 100%; }
.dx-linkBtn {
	background: none; border: 0; padding: 0; cursor: pointer;
	color: var(--dsw-alias-brand-primary); font-size: inherit; font-weight: 500;
}
.dx-linkBtn:hover { text-decoration: underline; }
.dx-linkBtn:disabled { color: var(--dsw-alias-label-secondary); cursor: default; text-decoration: none; }

/* ---------------------------------------------------------------- inputs */
.dx-input, .dx-select, .dx-textarea {
	width: 100%; min-width: 0; color: var(--dsw-alias-label-primary);
	background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
	font-family: inherit; font-size: 12.5px; padding: 0 10px; height: 30px;
	transition: border-color .15s ease;
}
.dx-textarea { height: auto; min-height: 68px; padding: 8px 10px; resize: vertical; line-height: 1.5; }
.dx-input:focus, .dx-select:focus, .dx-textarea:focus {
	outline: none; border-color: var(--dsw-alias-brand-primary);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}
.dx-input::placeholder, .dx-textarea::placeholder { color: var(--dsw-alias-label-secondary); }
.dx-select { appearance: none; padding-right: 26px; cursor: pointer;
	background-image: linear-gradient(45deg, transparent 50%, var(--dsw-alias-label-secondary) 50%), linear-gradient(135deg, var(--dsw-alias-label-secondary) 50%, transparent 50%);
	background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px;
	background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
}
.dx-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dx-fieldLabel { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-weight: 500; }
.dx-fieldError { color: var(--dsw-alias-state-error-primary); font-size: 11.5px; }
.dx-searchWrap { position: relative; display: inline-flex; align-items: center; min-width: 180px; flex: 1 1 220px; max-width: 320px; }
.dx-searchWrap .dx-input { padding-left: 30px; }
.dx-searchIcon { position: absolute; left: 9px; display: inline-flex; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.dx-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.dx-toolbarLeft { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0; }
.dx-toolbarRight { display: flex; align-items: center; gap: 8px; flex: none; }
.dx-segmented {
	display: inline-flex; align-items: center; gap: 2px; padding: 2px;
	border-radius: 9px; background: var(--dsw-alias-bg-layer-2);
	border: 1px solid var(--dsw-alias-border-l1);
}
.dx-segBtn {
	border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
	height: 24px; padding: 0 10px; border-radius: 7px; cursor: pointer;
	font-size: 11.5px; font-weight: 500;
	transition: background-color .15s ease, color .15s ease;
}
.dx-segBtn:hover { color: var(--dsw-alias-label-primary); }
.dx-segBtn[aria-pressed="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }

/* ---------------------------------------------------------------- switch */
.dx-switch {
	position: relative; flex: none; width: 36px; height: 20px; padding: 2px;
	border: 0; border-radius: 999px; cursor: pointer;
	background: var(--dsw-alias-border-l2);
	transition: background-color .18s ease;
}
.dx-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.dx-switch:disabled { cursor: default; opacity: .5; }
.dx-switchThumb {
	display: block; width: 16px; height: 16px; border-radius: 50%;
	background: var(--dsw-alias-label-primary);
	transition: transform .18s ease;
}
.dx-switch[aria-checked="true"] .dx-switchThumb { transform: translateX(16px); }

/* ---------------------------------------------------------- states / empty */
.dx-empty {
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 7px; padding: 26px 16px; text-align: center; color: var(--dsw-alias-label-secondary);
}
.dx-emptyIcon { display: inline-flex; opacity: .6; }
.dx-emptyTitle { font-size: 12.5px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dx-emptyText { font-size: 11.5px; max-width: 340px; }
.dx-error {
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 8px; padding: 30px 16px; text-align: center;
}
.dx-errorIcon { display: inline-flex; color: var(--dsw-alias-state-error-primary); }
.dx-errorTitle { font-size: 13px; font-weight: 600; }
.dx-errorText { font-size: 12px; color: var(--dsw-alias-label-secondary); max-width: 380px; }
.dx-guard { padding: 26px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dx-guardTitle { color: var(--dsw-alias-state-error-primary); font-weight: 600; margin-bottom: 4px; }
.dx-inlineError { color: var(--dsw-alias-state-error-primary); font-size: 11.5px; }

/* skeleton */
.dx-skelGrid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.dx-skelCard {
	border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1); padding: 16px; min-height: 118px;
	display: flex; flex-direction: column; gap: 10px;
}
.dx-skelLine {
	height: 10px; border-radius: 5px;
	background: linear-gradient(90deg, var(--dsw-alias-border-l1) 25%, var(--dsw-alias-bg-layer-2) 37%, var(--dsw-alias-border-l1) 63%);
	background-size: 400% 100%; animation: dx-shimmer 1.5s ease infinite;
}
.dx-skelLine[data-w="40"] { width: 40%; }
.dx-skelLine[data-w="60"] { width: 60%; }
.dx-skelLine[data-w="80"] { width: 80%; }
.dx-skelLine[data-w="100"] { width: 100%; }
.dx-skelLine[data-h="tall"] { height: 22px; }

/* ------------------------------------------------------------------ modal */
.dx-modalRoot { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.dx-modalMask {
	position: absolute; inset: 0;
	background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
	backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
	animation: dx-fadein .16s ease both;
}
.dx-modal {
	position: relative; z-index: 1; width: min(540px, 100%);
	max-height: min(720px, calc(100vh - 48px)); overflow: auto;
	border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-overlay);
	box-shadow: 0 24px 64px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
	animation: dx-modalin .18s ease both;
	scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2) transparent;
}
.dx-modal:focus { outline: none; }
.dx-modalHead { display: flex; align-items: flex-start; gap: 12px; padding: 18px 18px 6px; }
.dx-modalTitle { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 600; line-height: 1.35; }
.dx-modalClose { flex: none; }
.dx-modalBody { padding: 8px 18px 4px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dx-modalDetails { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; padding: 10px 12px; border-radius: 9px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); }
.dx-modalDetailRow { display: flex; gap: 10px; justify-content: space-between; font-size: 12px; }
.dx-modalDetailLabel { color: var(--dsw-alias-label-secondary); flex: none; }
.dx-modalDetailValue { color: var(--dsw-alias-label-primary); text-align: right; overflow-wrap: anywhere; }
.dx-modalFields { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.dx-modalFooter { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 16px 18px 18px; }

/* ----------------------------------------------------------------- toasts */
.dx-toasts {
	position: fixed; right: 20px; bottom: 20px; z-index: 1001;
	display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 40px));
}
.dx-toast {
	display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
	border-radius: 11px; border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-overlay);
	box-shadow: 0 14px 36px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
	animation: dx-toastin .2s ease both;
}
.dx-toastIcon { flex: none; display: inline-flex; margin-top: 1px; }
.dx-toast[data-tone="ok"] .dx-toastIcon { color: var(--dsw-alias-state-success-primary); }
.dx-toast[data-tone="fail"] .dx-toastIcon { color: var(--dsw-alias-state-error-primary); }
.dx-toastBody { flex: 1 1 auto; min-width: 0; }
.dx-toastTitle { font-size: 12.5px; font-weight: 600; }
.dx-toastMsg { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 2px; overflow-wrap: anywhere; }

/* ------------------------------------------------------------ action cards */
.dx-actionGroup { display: flex; flex-direction: column; gap: 12px; }
.dx-actionGrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.dx-actionCard {
	display: flex; flex-direction: column; gap: 10px; min-width: 0;
	border-radius: 12px; padding: 14px; background: var(--dsw-alias-bg-layer-1);
	border: 1px solid var(--dsw-alias-border-l1);
	transition: border-color .18s ease;
}
.dx-actionCard:hover { border-color: var(--dsw-alias-border-l2); }
.dx-actionHead { display: flex; align-items: flex-start; gap: 10px; }
.dx-actionIcon {
	flex: none; width: 30px; height: 30px; border-radius: 8px;
	display: inline-flex; align-items: center; justify-content: center;
	color: var(--dsw-alias-brand-primary);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}
.dx-actionTitles { min-width: 0; flex: 1 1 auto; }
.dx-actionTitle { font-weight: 600; font-size: 12.5px; }
.dx-actionDesc { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-top: 2px; line-height: 1.45; }
.dx-actionBadges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.dx-actionParams { display: flex; flex-direction: column; gap: 9px; }
.dx-actionFooter { display: flex; align-items: center; gap: 8px; margin-top: 2px; }

/* ---------------------------------------------------------------- history */
.dx-history { display: flex; flex-direction: column; }
.dx-historyRow { display: flex; align-items: flex-start; gap: 10px; padding: 8px 2px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dx-historyRow:first-child { border-top: none; }
.dx-historyDot { flex: none; width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; }
.dx-historyDot[data-tone="ok"] { background: var(--dsw-alias-state-success-primary); }
.dx-historyDot[data-tone="fail"] { background: var(--dsw-alias-state-error-primary); }
.dx-historyMain { flex: 1 1 auto; min-width: 0; }
.dx-historyTop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dx-historyAction { font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dx-historyMeta { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; flex: none; }
.dx-historyMsg { color: var(--dsw-alias-label-secondary); font-size: 11.5px; overflow-wrap: anywhere; margin-top: 1px; }

/* ------------------------------------------------------------- misc bits */
.dx-signalWrap { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.dx-signalBar { width: 3px; border-radius: 1px; background: var(--dsw-alias-border-l2); }
.dx-signalBar[data-on="true"] { background: var(--dsw-alias-state-success-primary); }
.dx-signalBar:nth-child(1) { height: 4px; }
.dx-signalBar:nth-child(2) { height: 7px; }
.dx-signalBar:nth-child(3) { height: 10px; }
.dx-signalBar:nth-child(4) { height: 13px; }
.dx-tagList { display: flex; flex-wrap: wrap; gap: 5px; }
.dx-sublist { display: flex; flex-direction: column; gap: 8px; }
.dx-subcard { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px 11px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 40%, transparent); }
.dx-subcardHead { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dx-subcardTitle { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.dx-subcardMeta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-top: 3px; overflow-wrap: anywhere; }

/* ------------------------------------------------------------- keyframes */
@keyframes dx-spin { to { transform: rotate(360deg); } }
@keyframes dx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes dx-fadein { from { opacity: 0; } to { opacity: 1; } }
@keyframes dx-modalin { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes dx-toastin { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes dx-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes dx-orbit { from { transform: rotateX(58deg) rotateZ(0deg); } to { transform: rotateX(58deg) rotateZ(360deg); } }
@keyframes dx-float { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(5px); } }
@keyframes dx-corePulse { 0%, 100% { box-shadow: 0 0 16px rgba(56, 189, 248, .6), 0 0 38px rgba(99, 102, 241, .4); } 50% { box-shadow: 0 0 24px rgba(56, 189, 248, .9), 0 0 56px rgba(99, 102, 241, .62); } }
@keyframes dx-drift { 0%, 100% { transform: translate3d(0, 0, 0); opacity: .55; } 50% { transform: translate3d(0, -12px, 0); opacity: 1; } }

/* ------------------------------------------------------------ responsive */
@media (max-width: 1080px) {
	.dx-heroCard { grid-template-columns: minmax(0, 1fr); }
	.dx-scene { height: 190px; }
}
@media (max-width: 880px) {
	.dx-body { flex-direction: column; gap: 12px; }
	.dx-rail {
		width: 100%; flex-direction: row; gap: 4px; padding: 0 0 8px;
		border-right: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l1);
		overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
	}
	.dx-rail::-webkit-scrollbar { display: none; }
	.dx-railTab { flex: none; height: 30px; padding: 0 12px; border-radius: 999px; }
	.dx-railTab[aria-selected="true"]::before { display: none; }
	.dx-title { max-width: 60vw; }
	.dx-card[data-span="2"] { grid-column: auto; }
}
@media (max-width: 720px) {
	.dx-header { flex-wrap: wrap; padding: calc(16px + var(--dsh-frame-top-clearance, 0px)) 16px 12px; gap: 10px; }
	.dx-body { padding: 12px 16px 16px; }
	.dx-headerActions { width: 100%; justify-content: flex-end; }
	.dx-title { font-size: 18px; max-width: 70vw; }
	.dx-heroTitle { font-size: 19px; }
	.dx-grid, .dx-grid2, .dx-grid3, .dx-kpiGrid, .dx-skelGrid, .dx-actionGrid { grid-template-columns: minmax(0, 1fr); }
	.dx-toasts { left: 16px; right: 16px; width: auto; bottom: 16px; }
	.dx-modalRoot { padding: 14px; }
	.dx-scene { height: 170px; }
}
@media (prefers-reduced-motion: reduce) {
	.dx-root *, .dx-root *::before, .dx-root *::after {
		animation-duration: .001ms !important; animation-iteration-count: 1 !important;
		transition-duration: .001ms !important; scroll-behavior: auto !important;
	}
}
`;

		// ------------------------------------------------------------------
		// HTTP API. Same-origin only; the page never talks to anything else.
		// ------------------------------------------------------------------
		const API_BASE = "/devicex/api";
		const REQUEST_HEADERS = { accept: "application/json" };

		async function readResponseBody(response) {
			let body = null;
			try {
				body = await response.json();
			} catch (_error) {
				body = null;
			}
			if (!response.ok) {
				const serverMessage = body && body.error && typeof body.error.message === "string" ? body.error.message : "";
				const error = new Error(serverMessage || "HTTP " + response.status);
				error.status = response.status;
				throw error;
			}
			return body;
		}
		function bodyError(body, fallback) {
			if (body && body.error && typeof body.error.message === "string" && body.error.message.length > 0) return body.error.message;
			if (body && typeof body.message === "string" && body.message.length > 0) return body.message;
			return fallback;
		}
		async function getJson(path) {
			const response = await fetch(path, { method: "GET", credentials: "same-origin", cache: "no-store", headers: REQUEST_HEADERS });
			const body = await readResponseBody(response);
			if (!body || body.ok !== true) throw new Error(bodyError(body, "Invalid response"));
			return body;
		}
		const api = {
			async metrics() {
				const body = await getJson(API_BASE + "/metrics");
				return body.metrics;
			},
			async section(section, fresh) {
				const query = "?section=" + encodeURIComponent(section) + (fresh ? "&fresh=1" : "");
				const body = await getJson(API_BASE + "/inventory" + query);
				return body.data;
			},
			async actions() {
				const body = await getJson(API_BASE + "/actions");
				return { platform: body.platform, actions: body.actions, history: body.history };
			},
			async runAction(actionId, params) {
				let body = null;
				try {
					const response = await fetch(API_BASE + "/action", {
						method: "POST",
						credentials: "same-origin",
						cache: "no-store",
						headers: { accept: "application/json", "content-type": "application/json" },
						body: JSON.stringify({ action: actionId, params: params && typeof params === "object" ? params : {} }),
					});
					body = await readResponseBody(response);
				} catch (error) {
					return { ok: false, message: safeErrorText(error) || "Request failed" };
				}
				const result = asObject(body);
				return { ok: result.ok === true, message: strOr(result.message, ""), data: result.data };
			},
		};

		// ------------------------------------------------------------------
		// Payload normalizers. They accept anything and return the documented
		// shape with safe defaults, so render helpers can stay compact.
		// ------------------------------------------------------------------
		function normalizeTopProcess(value) {
			const row = asObject(value);
			if (!isFiniteNumber(row.pid)) return null;
			return {
				pid: row.pid,
				name: strOr(row.name, "?"),
				cpu: numOrNull(row.cpu),
				memPercent: numOrNull(row.memPercent),
				user: strOr(row.user, ""),
			};
		}
		function normalizeMetrics(raw) {
			const source = asObject(raw);
			const cpu = asObject(source.cpu);
			const memory = asObject(source.memory);
			const disk = asObject(source.disk);
			const network = asObject(source.network);
			const wifi = isObj(network.wifi) ? network.wifi : null;
			const battery = isObj(source.battery) ? source.battery : null;
			const thermal = asObject(source.thermal);
			const processes = asObject(source.processes);
			return {
				ts: numOr(source.ts, Date.now()),
				hostname: strOr(source.hostname, ""),
				osVersion: strOr(source.osVersion, ""),
				uptimeSec: numOrNull(source.uptimeSec),
				cpu: {
					model: strOr(cpu.model, ""),
					usagePercent: numOrNull(cpu.usagePercent),
					perCore: asArray(cpu.perCore).filter(isFiniteNumber).slice(0, 64),
					loadAvg: asArray(cpu.loadAvg).map((value) => numOr(value, 0)).slice(0, 3),
					logicalCores: numOrNull(cpu.logicalCores),
					physicalCores: numOrNull(cpu.physicalCores),
				},
				memory: {
					totalBytes: numOrNull(memory.totalBytes),
					usedBytes: numOrNull(memory.usedBytes),
					appBytes: numOrNull(memory.appBytes),
					wiredBytes: numOrNull(memory.wiredBytes),
					compressedBytes: numOrNull(memory.compressedBytes),
					cachedBytes: numOrNull(memory.cachedBytes),
					freeBytes: numOrNull(memory.freeBytes),
					swapTotalBytes: numOrNull(memory.swapTotalBytes),
					swapUsedBytes: numOrNull(memory.swapUsedBytes),
					pressure: ["normal", "warning", "critical"].indexOf(memory.pressure) >= 0 ? memory.pressure : "normal",
				},
				disk: {
					totalBytes: numOrNull(disk.totalBytes),
					usedBytes: numOrNull(disk.usedBytes),
					freeBytes: numOrNull(disk.freeBytes),
					readBytesPerSec: numOrNull(disk.readBytesPerSec),
					writeBytesPerSec: numOrNull(disk.writeBytesPerSec),
				},
				network: {
					rxBytesPerSec: numOrNull(network.rxBytesPerSec),
					txBytesPerSec: numOrNull(network.txBytesPerSec),
					wifi: wifi
						? { ssid: strOr(wifi.ssid, ""), rssi: numOrNull(wifi.rssi), channel: numOrNull(wifi.channel) }
						: null,
					primaryIpv4: asArray(network.primaryIpv4).filter((value) => typeof value === "string"),
					defaultInterface: strOr(network.defaultInterface, ""),
				},
				battery: battery
					? {
							present: battery.present !== false,
							percent: numOrNull(battery.percent),
							charging: battery.charging === true,
							plugged: battery.plugged === true,
							powerSource: strOr(battery.powerSource, ""),
							timeRemainingMin: numOrNull(battery.timeRemainingMin),
							temperatureC: numOrNull(battery.temperatureC),
							cycleCount: numOrNull(battery.cycleCount),
							healthPercent: numOrNull(battery.healthPercent),
						}
					: null,
				thermal: { cpuTempC: numOrNull(thermal.cpuTempC) },
				processes: {
					total: numOrNull(processes.total),
					top: asArray(processes.top).map(normalizeTopProcess).filter(Boolean),
				},
			};
		}
		function normalizeParam(raw) {
			const source = asObject(raw);
			const name = strOr(source.name, "");
			if (!name) return null;
			const type = ["number", "string", "boolean", "select"].indexOf(source.type) >= 0 ? source.type : "string";
			return {
				name,
				type,
				required: source.required === true,
				options: source.options === undefined || source.options === null ? null : asArray(source.options).map((value) => String(value)),
				min: numOrNull(source.min),
				max: numOrNull(source.max),
				placeholder: strOr(source.placeholder, ""),
			};
		}
		function normalizeAction(raw) {
			const source = asObject(raw);
			const id = strOr(source.id, "");
			if (!id) return null;
			const params = asArray(source.params).map(normalizeParam).filter(Boolean).slice(0, 12);
			return {
				id,
				group: strOr(source.group, "system"),
				danger: ["low", "medium", "high"].indexOf(source.danger) >= 0 ? source.danger : "low",
				requiresAdmin: source.requiresAdmin === true,
				params,
			};
		}
		function normalizeActions(raw) {
			const seen = {};
			const result = [];
			for (const entry of asArray(raw)) {
				const action = normalizeAction(entry);
				if (!action || seen[action.id]) continue;
				seen[action.id] = true;
				result.push(action);
			}
			return result;
		}
		function normalizeHistoryEntry(raw) {
			const source = asObject(raw);
			const id = strOr(source.id, "");
			if (!id) return null;
			return {
				ts: numOr(source.ts, 0),
				id,
				params: isObj(source.params) ? source.params : {},
				ok: source.ok === true,
				message: strOr(source.message, ""),
			};
		}
		function normalizeHistory(raw) {
			return asArray(raw)
				.map(normalizeHistoryEntry)
				.filter(Boolean)
				.slice(0, 50);
		}
		function mergeHistory(live, server) {
			const seen = {};
			const result = [];
			const push = (entry) => {
				const key = String(entry.ts) + "|" + entry.id + "|" + entry.message;
				if (seen[key]) return;
				seen[key] = true;
				result.push(entry);
			};
			for (const entry of asArray(live)) push(entry);
			for (const entry of asArray(server)) push(entry);
			return result.slice(0, 50);
		}

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
		function Icon(props) {
			const name = strOr(props.name, "info");
			const size = numOr(props.size, 16);
			const shapes = ICONS[name] || ICONS.info;
			const children = shapes.map((shape, index) => h(shape[0], Object.assign({ key: index }, shape[1])));
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: numOr(props.strokeWidth, 1.7),
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
					className: props.className,
				},
				children,
			);
		}

		function Card(props) {
			const head =
				props.title || props.subtitle || props.actions
					? h(
							"div",
							{ className: "dx-cardHead" },
							props.icon ? h("span", { className: "dx-cardHeadIcon" }, h(Icon, { name: props.icon, size: 15 })) : null,
							h(
								"div",
								{ className: "dx-cardTitles" },
								props.title ? h("h2", { className: "dx-cardTitle" }, props.title) : null,
								props.subtitle ? h("p", { className: "dx-cardSub" }, props.subtitle) : null,
							),
							props.actions ? h("div", { className: "dx-cardActions" }, props.actions) : null,
						)
					: null;
			return h(
				"section",
				{ className: joinClass("dx-card", props.className), "data-span": props.span === 2 ? "2" : undefined },
				head,
				h("div", { className: props.flush ? "dx-cardBody dx-cardBodyFlush" : "dx-cardBody" }, props.children),
			);
		}

		function Pill(props) {
			return h("span", { className: "dx-pill", "data-tone": props.tone || "idle", title: props.title }, props.children);
		}

		function Switch(props) {
			return h(
				"button",
				{
					type: "button",
					className: "dx-switch",
					role: "switch",
					"aria-checked": props.checked === true,
					"aria-label": props.label,
					disabled: props.disabled === true,
					onClick: props.onChange,
				},
				h("span", { className: "dx-switchThumb", "aria-hidden": "true" }),
			);
		}

		function Donut(props) {
			const size = numOr(props.size, 62);
			const stroke = numOr(props.stroke, 7);
			const percent = isFiniteNumber(props.value) ? clamp(props.value, 0, 100) : null;
			const radius = (size - stroke) / 2;
			const circumference = 2 * Math.PI * radius;
			const filled = percent === null ? 0 : (percent / 100) * circumference;
			return h(
				"div",
				{ className: "dx-donutWrap", style: { width: size, height: size }, role: "img", "aria-label": strOr(props.label, fmtPercent(percent)) },
				h(
					"svg",
					{ width: size, height: size, viewBox: "0 0 " + size + " " + size, "aria-hidden": "true" },
					h("circle", {
						cx: size / 2,
						cy: size / 2,
						r: radius,
						fill: "none",
						stroke: "var(--dsw-alias-border-l1)",
						strokeWidth: stroke,
					}),
					h("circle", {
						cx: size / 2,
						cy: size / 2,
						r: radius,
						fill: "none",
						stroke: strOr(props.color, "var(--dsw-alias-brand-primary)"),
						strokeWidth: stroke,
						strokeLinecap: "round",
						strokeDasharray: filled.toFixed(2) + " " + circumference.toFixed(2),
						transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")",
						style: { transition: "stroke-dasharray .55s ease" },
					}),
				),
				props.centerText === undefined || props.centerText === null ? null : h("div", { className: "dx-donutCenter" }, props.centerText),
			);
		}

		function Sparkline(props) {
			const height = numOr(props.height, 26);
			const series = asArray(props.series).filter((entry) => isObj(entry) && asArray(entry.values).length >= 2);
			if (series.length === 0) return h("div", { className: "dx-spark dx-sparkEmpty", "aria-hidden": "true" });
			let max = numOr(props.domainMax, 0);
			if (!(max > 0)) {
				for (const entry of series) {
					for (const value of entry.values) {
						if (isFiniteNumber(value) && value > max) max = value;
					}
				}
			}
			if (!(max > 0)) max = 1;
			const innerHeight = Math.max(4, height - 4);
			const parts = [];
			series.forEach((entry, seriesIndex) => {
				const values = asArray(entry.values).filter(isFiniteNumber);
				if (values.length < 2) return;
				const step = 100 / (values.length - 1);
				const points = values.map((value, index) => {
					const x = index * step;
					const y = height - 2 - (clamp(value, 0, max) / max) * innerHeight;
					return x.toFixed(2) + "," + y.toFixed(2);
				});
				const color = strOr(entry.color, "var(--dsw-alias-brand-primary)");
				if (seriesIndex === 0) {
					parts.push(
						h("path", {
							key: "area-" + seriesIndex,
							d: "M0," + height + " L" + points.join(" L") + " L100," + height + " Z",
							fill: color,
							opacity: 0.1,
							stroke: "none",
						}),
					);
				}
				parts.push(
					h("polyline", {
						key: "line-" + seriesIndex,
						points: points.join(" "),
						fill: "none",
						stroke: color,
						strokeWidth: 1.5,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						vectorEffect: "non-scaling-stroke",
					}),
				);
			});
			if (parts.length === 0) return h("div", { className: "dx-spark dx-sparkEmpty", "aria-hidden": "true" });
			return h(
				"svg",
				{
					className: "dx-spark",
					viewBox: "0 0 100 " + height,
					preserveAspectRatio: "none",
					"aria-hidden": "true",
					focusable: "false",
				},
				parts,
			);
		}

		function Bar(props) {
			const percent = isFiniteNumber(props.percent) ? clamp(props.percent, 0, 100) : 0;
			return h(
				"div",
				{ className: "dx-barRow" },
				h(
					"div",
					{ className: "dx-barHead" },
					h("span", { className: "dx-truncate" }, props.label),
					h("span", null, isFiniteNumber(props.percent) ? fmtPercent(percent) : "—"),
				),
				h("div", { className: "dx-barTrack", role: "presentation" }, h("div", { className: "dx-barFill", style: { width: percent + "%", background: strOr(props.color, usageTone(percent)) } })),
			);
		}

		function SignalBars(props) {
			const level = clamp(numOr(props.level, 0), 0, 4);
			return h(
				"span",
				{ className: "dx-signalWrap", role: "img", "aria-label": strOr(props.label, "Signal " + level + "/4") },
				[1, 2, 3, 4].map((index) => h("span", { key: index, className: "dx-signalBar", "data-on": index <= level ? "true" : "false" })),
			);
		}

		function EmptyState(props) {
			return h(
				"div",
				{ className: "dx-empty" },
				h("span", { className: "dx-emptyIcon" }, h(Icon, { name: strOr(props.icon, "info"), size: 22 })),
				props.title ? h("p", { className: "dx-emptyTitle" }, props.title) : null,
				props.text ? h("p", { className: "dx-emptyText" }, props.text) : null,
				props.action || null,
			);
		}

		function Skeleton(props) {
			const lines = asArray(props.lines).length > 0 ? props.lines : ["40", "80", "60", "100"];
			return h(
				"div",
				{ className: "dx-skelGrid", "aria-hidden": "true" },
				Array.from({ length: numOr(props.cards, 3) }).map((_ignored, index) =>
					h(
						"div",
						{ className: "dx-skelCard", key: index },
						h("div", { className: "dx-skelLine", "data-w": "40" }),
						h("div", { className: "dx-skelLine", "data-w": "100", "data-h": "tall" }),
						h(
							"div",
							{ style: { display: "flex", gap: "8px" } },
							lines.map((width, lineIndex) => h("div", { key: lineIndex, className: "dx-skelLine", "data-w": width, style: { flex: 1 } })),
						),
					),
				),
			);
		}

		function ErrorState(props) {
			return h(
				"div",
				{ className: "dx-error", role: "alert" },
				h("span", { className: "dx-errorIcon" }, h(Icon, { name: "warning", size: 24 })),
				props.title ? h("p", { className: "dx-errorTitle" }, props.title) : null,
				props.text ? h("p", { className: "dx-errorText" }, props.text) : null,
				props.onRetry
					? h("button", { type: "button", className: "dx-btn", "data-variant": "primary", onClick: props.onRetry }, h(Icon, { name: "refresh", size: 14 }), props.retryLabel || props.t("common.retry"))
					: null,
			);
		}

		function SectionHead(props) {
			return h(
				"div",
				{ className: "dx-sectionHead" },
				h("h2", { className: "dx-sectionTitle" }, props.title),
				props.subtitle ? h("span", { className: "dx-sectionSub" }, props.subtitle) : null,
			);
		}

		function Fact(props) {
			return h(
				"div",
				{ className: "dx-fact", "data-wide": props.wide ? "true" : undefined },
				h("div", { className: "dx-factLabel" }, props.label),
				h("div", { className: "dx-factValue", title: typeof props.title === "string" ? props.title : undefined }, props.value),
			);
		}

		function FactGrid(props) {
			const items = asArray(props.items).filter(Boolean);
			if (items.length === 0) return h(EmptyState, { title: props.emptyText || props.t("common.empty") });
			return h(
				"div",
				{ className: "dx-factGrid" },
				items.map((item, index) => h(Fact, { key: item.key || index, label: item.label, value: item.value, wide: item.wide, title: item.title })),
			);
		}

		function DataTable(props) {
			const rows = asArray(props.rows);
			if (rows.length === 0) {
				if (props.empty) return props.empty;
				return h(EmptyState, { title: props.t("common.empty") });
			}
			const columns = asArray(props.columns);
			return h(
				"div",
				{ className: "dx-tableWrap" },
				h(
					"table",
					{ className: "dx-table", "aria-label": props.ariaLabel },
					h(
						"thead",
						null,
						h(
							"tr",
							null,
							columns.map((column) => h("th", { key: column.key, scope: "col", className: column.className }, column.label)),
						),
					),
					h(
						"tbody",
						null,
						rows.map((row, index) =>
							h(
								"tr",
								{ key: props.rowKey ? props.rowKey(row, index) : index },
								columns.map((column) =>
									h(
										"td",
										{ key: column.key, className: joinClass(column.cellClass, column.align === "right" ? "dx-num" : "") },
										column.render ? column.render(row, index) : strOr(asObject(row)[column.key], "—"),
									),
								),
							),
						),
					),
				),
			);
		}

		function SearchField(props) {
			return h(
				"div",
				{ className: "dx-searchWrap" },
				h("span", { className: "dx-searchIcon" }, h(Icon, { name: "search", size: 14 })),
				h("input", {
					type: "search",
					className: "dx-input",
					value: strOr(props.value, ""),
					placeholder: props.placeholder,
					"aria-label": props.label || props.placeholder,
					onChange: (event) => props.onChange(event.target.value),
				}),
			);
		}

		function SegmentedControl(props) {
			const options = asArray(props.options);
			return h(
				"div",
				{ className: "dx-segmented", role: "group", "aria-label": props.label },
				options.map((option) =>
					h(
						"button",
						{
							key: option.value,
							type: "button",
							className: "dx-segBtn",
							"aria-pressed": props.value === option.value,
							onClick: () => props.onChange(option.value),
						},
						option.label,
					),
				),
			);
		}

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
			const temperature = metrics.thermal.cpuTempC;
			if (temperature !== null && temperature >= 90) {
				alerts.push({ key: "thermal", icon: "warning", tone: "error", text: t("overview.alert.thermal", { temp: Math.round(temperature) }) });
			}
			return alerts;
		}

		/** Pure-CSS layered device core; decorative only (hidden from the a11y tree). */
		function DeviceScene(props) {
			const ring = (layer, id) => h("div", { className: "dx-orbit", "data-layer": String(layer) }, h("div", { className: "dx-ring", "data-ring": String(id) }));
			return h(
				"div",
				{ className: "dx-scene", "data-motion": props.animated === false ? "off" : "on", "aria-hidden": "true" },
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
						h("div", { className: "dx-chipCore" }),
					),
				),
				[1, 2, 3, 4].map((particle) => h("span", { key: "particle-" + particle, className: "dx-particle", "data-p": String(particle) })),
				h("span", { className: "dx-sceneCaption" }, "DEVICE X"),
			);
		}

		function KpiCard(props) {
			return h(
				"div",
				{ className: "dx-kpi" },
				h(
					"div",
					{ className: "dx-kpiTop" },
					props.donut,
					h(
						"div",
						{ className: "dx-kpiMeta" },
						h("div", { className: "dx-kpiLabel" }, props.label),
						h("div", { className: "dx-kpiValue" }, props.value),
						props.sub ? h("div", { className: "dx-kpiSub", title: props.subTitle || undefined }, props.sub) : null,
					),
				),
				h("div", { className: "dx-kpiSpark" }, props.spark),
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
			if (status === "idle" || (status === "loading" && !state.data)) return h(Skeleton, { cards: numOr(props.skeletonCards, 3) });
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

		function SubCard(props) {
			return h(
				"div",
				{ className: "dx-subcard" },
				h(
					"div",
					{ className: "dx-subcardHead" },
					props.icon ? h("span", { className: "dx-muted" }, h(Icon, { name: props.icon, size: 14 })) : null,
					h("span", { className: "dx-subcardTitle" }, props.title),
					props.badge || null,
				),
				props.meta ? h("div", { className: "dx-subcardMeta" }, props.meta) : null,
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
							title: t("sys.launchAgents"),
							icon: "agent",
							subtitle: String(launchAgents.length),
							flush: true,
							actions: agentPending ? h("span", { className: "dx-pill", "data-tone": "brand" }, t("common.pending")) : null,
							children: h(DataTable, {
								t,
								ariaLabel: t("sys.launchAgents"),
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
												const isSystemApp = strOr(row.source, "") === "system" || path.indexOf("/System/") === 0;
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
															title: t("sw.reveal"),
															"aria-label": t("sw.reveal") + " " + strOr(row.name, ""),
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
															disabled: !path || isSystemApp || pending["app.uninstall"] === true,
															title: isSystemApp ? t("sw.systemAppNote") : t("sw.uninstall"),
															"aria-label": t("sw.uninstall") + " " + strOr(row.name, ""),
															onClick: () =>
																props.openConfirm({
																	title: t("sw.uninstallTitle", { name: strOr(row.name, "—") }),
																	description: t("sw.uninstallBody"),
																	confirmLabel: t("sw.uninstall"),
																	danger: true,
																	actionId: "app.uninstall",
																	params: { path, mode: "trash" },
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
							title: t("sw.homebrew"),
							icon: "database",
							subtitle: homebrew.available === true ? strOr(homebrew.prefix, "") : t("sw.brewNotAvailable"),
							flush: true,
							children:
								homebrew.available !== true
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
						outdated.length > 0
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
							h(SecurityStatusCard, { t, title: t("sec.fileVault"), icon: "lock", info: fileVault }),
							h(SecurityStatusCard, { t, title: t("sec.sip"), icon: "security", info: sip }),
							h(SecurityStatusCard, { t, title: t("sec.gatekeeper"), icon: "firewall", info: gatekeeper }),
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
								t("sec.openFileVault"),
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
											h("p", { className: "dx-emptyTitle" }, t("sec.tccUnreadable")),
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
									t("sec.openFileVault"),
								),
								h(
									"button",
									{ type: "button", className: "dx-btn", onClick: () => props.openPane(["firewall"], "firewall") },
									h(Icon, { name: "firewall", size: 13 }),
									t("sec.openFirewall"),
								),
								h(
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
			const [catalog, setCatalog] = useState({ status: "idle", actions: [], history: [], error: null });
			const [liveHistory, setLiveHistory] = useState([]);
			const [modal, setModal] = useState(null);
			const [modalBusy, setModalBusy] = useState(false);
			const [modalError, setModalError] = useState("");
			const [toasts, setToasts] = useState([]);
			const [pending, setPending] = useState({});
			const [refreshing, setRefreshing] = useState(false);
			const sectionsInFlight = useRef({});
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
						setCatalog({ status: "ready", actions: normalizeActions(result.actions), history: normalizeHistory(result.history), error: null });
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
			useEffect(() => {
				const section = SECTION_TABS[activeTab];
				if (!section) return;
				const current = sections[section];
				if (!current || current.status === "idle") loadSection(section, false);
			}, [activeTab, sections, loadSection]);

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
									SIGNALS.map((option) => h("option", { key: option, value: option }, optionLabel(t, option))),
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
			} else {
				const TabComponent = SECTION_COMPONENTS[activeTab];
				body = TabComponent
					? h(TabComponent, {
							t,
							state: sectionState,
							metrics,
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
	},
});
