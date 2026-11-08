/**
 * Device X browser entry.
 *
 * The shipped client plugin format is `window.__ModuleLoader__.load({ id, factory })`;
 * esbuild bundles this source tree into the single-file `plugin/client.js` that the
 * Host serves. `react` is still taken from the loader factory (the platform seed),
 * never bundled.
 */
import { setReact } from "./runtime.js";
import { createClient } from "./core.js";

window.__ModuleLoader__.load({
	id: "@cfour-hi/dsh-plugin-devicex",
	factory: (require) => {
		setReact(require("react"));
		return createClient();
	},
});
