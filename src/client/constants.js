// Generated source split of the Device X client: frozen UI constants (no React).
		/** Dictionary namespace owned by this plugin page. */
		const NS = "devicex";
		/** Panel key shared by the main panel and its sidebar icon entry. */
		const PANEL_ID = "devicex";
		/** Metrics poll cadence while the page is mounted. */
		const POLL_MS = 2500;
		/** Client-side ring buffer length for the Overview sparklines. */
		const MAX_SAMPLES = 60;

		const TAB_IDS = ["overview", "hardware", "system", "software", "network", "security", "processes", "cleanup", "benchmark", "actions"];
		const TAB_LABEL_KEYS = {
			overview: "tab.overview",
			hardware: "tab.hardware",
			system: "tab.system",
			software: "tab.software",
			network: "tab.network",
			security: "tab.security",
			processes: "tab.processes",
			cleanup: "tab.cleanup",
			benchmark: "tab.benchmark",
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
			cleanup: "trash",
			benchmark: "spark",
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
			"software.wingetUninstall": { group: "software", danger: "medium", requiresAdmin: false, icon: "software", labelKey: "action.software.wingetUninstall", descKey: "action.software.wingetUninstall.desc" },
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

export {
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
};
