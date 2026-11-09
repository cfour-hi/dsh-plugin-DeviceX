// @ts-check
// Generated source split of the Device X client: same-origin HTTP API.
import { asObject, strOr, safeErrorText } from "./helpers.js";
import { normalizeBenchmark } from "./normalizers.js";

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
				const error = /** @type {Error & {status?: number}} */ (new Error(serverMessage || "HTTP " + response.status));
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
			async cleanup(fresh) {
				const body = await getJson(API_BASE + "/cleanup" + (fresh === true ? "?fresh=1" : ""));
				return body.cleanup;
			},
			async footprint(appPath, fresh) {
				const query = "?path=" + encodeURIComponent(String(appPath || "")) + (fresh === true ? "&fresh=1" : "");
				const body = await getJson(API_BASE + "/footprint" + query);
				return body.footprint;
			},
			async benchmark(options) {
				let body = null;
				try {
					const response = await fetch(API_BASE + "/benchmark", {
						method: "POST",
						credentials: "same-origin",
						cache: "no-store",
						headers: { accept: "application/json", "content-type": "application/json" },
						body: JSON.stringify(options && typeof options === "object" ? options : {}),
					});
					body = await readResponseBody(response);
				} catch (error) {
					return { ok: false, benchmark: null, message: safeErrorText(error) || "Request failed" };
				}
				const result = asObject(body);
				const benchmark = normalizeBenchmark(result.benchmark);
				return { ok: result.ok === true && benchmark !== null, benchmark, message: bodyError(result, "") };
			},
		};

export {
	API_BASE,
	REQUEST_HEADERS,
	readResponseBody,
	bodyError,
	getJson,
	api,
};
