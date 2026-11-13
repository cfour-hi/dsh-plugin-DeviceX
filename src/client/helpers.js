// @ts-check
// Generated source split of the Device X client: defensive accessors and formatters (no React).
		// ------------------------------------------------------------------
		// Safe value helpers. Every Host payload field is untrusted: these
		// accessors never throw and never produce `undefined` in rendered text.
		// ------------------------------------------------------------------
		const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
		const asObject = (value) => (isObj(value) ? value : {});
		const asArray = (value) => (Array.isArray(value) ? value : []);
		/** @type {(value: unknown) => value is number} */
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
			const digits = scaled >= 100 ? 0 : 1;
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
		/** Compact uptime, at most two units ("3 d 4 h", "12 min", "less than a minute"). */
		function fmtUptime(seconds, t) {
			if (!isFiniteNumber(seconds) || seconds < 0) return "—";
			const total = Math.floor(seconds);
			const day = Math.floor(total / 86400);
			const hour = Math.floor((total % 86400) / 3600);
			const minute = Math.floor((total % 3600) / 60);
			const parts = [];
			if (day > 0) parts.push(day + " " + t("unit.day"));
			if (hour > 0) parts.push(hour + " " + t("unit.hour"));
			// Minutes are the finest unit shown, so a sub-minute duration says so
			// rather than reading "0 min".
			if (day === 0 && hour === 0) {
				if (minute === 0) return t("unit.lessThanMinute");
				parts.push(minute + " " + t("unit.minute"));
			}
			return parts.slice(0, 2).join(" ");
		}
		/** Format a millisecond duration for benchmark/scan timings. */
		function fmtMs(value) {
			if (!isFiniteNumber(value)) return "—";
			if (value < 1000) return Math.round(value) + " ms";
			return (value / 1000).toFixed(value < 10_000 ? 1 : 0) + " s";
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

export {
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
};
