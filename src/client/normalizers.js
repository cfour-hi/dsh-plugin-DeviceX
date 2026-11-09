// @ts-check
// Generated source split of the Device X client: Host payload normalizers.
//
// Type-only contract references (P0): the browser half is still checked by
// esbuild rather than tsc, but these typedefs point editors at the frozen
// shapes in types/contracts.ts. They are comments, so they add no runtime.
/** @typedef {import("../../types/contracts.js").Metrics} Metrics */
/** @typedef {import("../../types/contracts.js").CleanupPayload} CleanupPayload */
/** @typedef {import("../../types/contracts.js").BenchmarkRun} BenchmarkRun */
/** @typedef {import("../../types/contracts.js").ActionResult} ActionResult */
import { asArray, asObject, isFiniteNumber, isObj, numOr, numOrNull, strOr } from "./helpers.js";

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
				thermal: normalizeThermal(source.thermal),
				processes: {
					total: numOrNull(processes.total),
					top: asArray(processes.top).map(normalizeTopProcess).filter(Boolean),
				},
			};
		}
		function normalizeThermal(raw) {
			const source = asObject(raw);
			const fans = asArray(source.fans)
				.map((rawFan) => {
					const fan = asObject(rawFan);
					return { name: strOr(fan.name, ""), rpm: numOrNull(fan.rpm) };
				})
				.filter((fan) => fan.name !== "" || fan.rpm !== null)
				.slice(0, 4);
			const cpuCelsius = numOrNull(source.cpuCelsius);
			const gpuCelsius = numOrNull(source.gpuCelsius);
			const batteryCelsius = numOrNull(source.batteryCelsius);
			const nvmeCelsius = numOrNull(source.nvmeCelsius);
			return {
				available: source.available === true || [cpuCelsius, gpuCelsius, batteryCelsius, nvmeCelsius].some((value) => value !== null),
				cpuCelsius,
				gpuCelsius,
				batteryCelsius,
				nvmeCelsius,
				pressure: ["nominal", "fair", "serious", "critical"].indexOf(source.pressure) >= 0 ? source.pressure : null,
				fans,
				sources: asArray(source.sources).filter((entry) => typeof entry === "string").slice(0, 8),
				note: ["cpu-needs-admin", "wmi-unsupported", "unavailable"].indexOf(source.note) >= 0 ? source.note : null,
			};
		}
		function normalizeFootprint(raw) {
			const source = asObject(raw);
			const tiers = ["high", "medium", "conflict", "shared"];
			const kinds = ["app", "data", "container", "shared", "system"];
			const items = asArray(source.items)
				.map((rawItem) => {
					const item = asObject(rawItem);
					const id = strOr(item.id, "");
					const path = strOr(item.path, "");
					if (!id || !path) return null;
					const confidence = tiers.indexOf(item.confidence) >= 0 ? item.confidence : "shared";
					const adminOnly = item.requiresAdmin === true;
					return {
						id,
						kind: kinds.indexOf(item.kind) >= 0 ? item.kind : "data",
						path,
						displayPath: strOr(item.displayPath, path),
						bytes: numOr(item.bytes, 0),
						files: numOr(item.files, 0),
						confidence,
						source: strOr(item.source, "bundle-id"),
						reason: strOr(item.reason, ""),
						alsoMatchedBy: asArray(item.alsoMatchedBy).filter((entry) => typeof entry === "string").slice(0, 8),
						requiresAdmin: item.requiresAdmin === true,
						exists: item.exists !== false,
						warning: strOr(item.warning, ""),
						// Only tier A is preselected. B/C need an explicit opt-in and
						// D (shared) is reference-only, so it has no checkbox at all.
						// An item the host cannot remove (admin-only) is not offered
						// either: the host refuses such ids, so a checkbox for it would
						// only produce a failed cleanup request.
						selectable:
							!adminOnly && (confidence === "high" || confidence === "medium" || confidence === "conflict"),
						defaultSelected: !adminOnly && confidence === "high",
					};
				})
				.filter(Boolean)
				.slice(0, 200);
			return {
				scanId: strOr(source.scanId, ""),
				appPath: strOr(source.appPath, ""),
				bundleId: strOr(source.bundleId, ""),
				sandboxed: source.sandboxed === true,
				targetedRoots: asArray(source.targetedRoots).filter((entry) => typeof entry === "string").slice(0, 32),
				generatedAt: numOr(source.generatedAt, 0),
				durationMs: numOr(source.durationMs, 0),
				items,
				totalBytes: numOr(source.totalBytes, 0),
				selectedBytes: numOr(source.selectedBytes, 0),
				errors: asArray(source.errors).filter((entry) => typeof entry === "string").slice(0, 8),
			};
		}
		function normalizeCleanup(raw) {
			const source = asObject(raw);
			const categories = ["cache", "logs", "trash", "temp", "developer", "updates"];
			const items = asArray(source.items)
				.map((rawItem) => {
					const item = asObject(rawItem);
					const id = strOr(item.id, "");
					if (!id) return null;
					return {
						id,
						label: strOr(item.label, id),
						detail: strOr(item.detail, ""),
						category: categories.indexOf(item.category) >= 0 ? item.category : "cache",
						path: strOr(item.path, ""),
						bytes: numOr(item.bytes, 0),
						files: numOr(item.files, 0),
						requiresAdmin: item.requiresAdmin === true,
						exists: item.exists !== false,
						error: strOr(item.error, ""),
					};
				})
				.filter(Boolean)
				.slice(0, 40);
			return {
				platform: strOr(source.platform, ""),
				generatedAt: numOr(source.generatedAt, 0),
				durationMs: numOr(source.durationMs, 0),
				items,
				totalBytes: numOr(source.totalBytes, 0),
				totalFiles: numOr(source.totalFiles, 0),
				errors: asArray(source.errors).filter((entry) => typeof entry === "string").slice(0, 8),
			};
		}
		function normalizeBenchmark(raw) {
			const source = asObject(raw);
			const env = asObject(source.environment);
			const results = asArray(source.results)
				.map((rawResult) => {
					const entry = asObject(rawResult);
					const id = strOr(entry.id, "");
					if (id !== "cpu" && id !== "memory" && id !== "disk") return null;
					return {
						id,
						durationMs: numOrNull(entry.durationMs),
						score: numOrNull(entry.score),
						unit: strOr(entry.unit, id === "memory" ? "GB/s" : id === "disk" ? "MB/s" : "ops/s"),
						details: asObject(entry.details),
						error: strOr(entry.error, ""),
					};
				})
				.filter(Boolean);
			const previous = isObj(source.previous)
				? {
						at: numOrNull(source.previous.at),
						results: asArray(source.previous.results)
							.map((rawPrevious) => {
								const entry = asObject(rawPrevious);
								const id = strOr(entry.id, "");
								return id ? { id, score: numOrNull(entry.score) } : null;
							})
							.filter(Boolean),
					}
				: null;
			return {
				platform: strOr(source.platform, ""),
				startedAt: numOrNull(source.startedAt),
				durationMs: numOrNull(source.durationMs),
				environment: {
					hostname: strOr(env.hostname, ""),
					cpuModel: strOr(env.cpuModel, ""),
					logicalCores: numOrNull(env.logicalCores),
					physicalCores: numOrNull(env.physicalCores),
					memoryBytes: numOrNull(env.memoryBytes),
					osVersion: strOr(env.osVersion, ""),
				},
				results,
				previous,
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

export {
	normalizeTopProcess,
	normalizeMetrics,
	normalizeThermal,
	normalizeCleanup,
	normalizeFootprint,
	normalizeBenchmark,
	normalizeParam,
	normalizeAction,
	normalizeActions,
	normalizeHistoryEntry,
	normalizeHistory,
	mergeHistory,
};
