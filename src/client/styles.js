/**
 * Stylesheet bridge: the CSS source lives in `styles.css`.
 *
 * DSH loads browser plugins as JavaScript only, so the stylesheet is not a
 * runtime request. Both build engines compile the CSS file into a string:
 * esbuild uses the `text` loader (`scripts/build-client.mjs`), and the
 * no-bundler fallback inlines CSS imports (`scripts/build-client-concat.mjs`).
 * `core.js` still imports `STYLE_TEXT` from this module and injects one
 * disposable <style data-devicex> into <head>.
 */
import STYLE_TEXT from "./styles.css";

export { STYLE_TEXT };
