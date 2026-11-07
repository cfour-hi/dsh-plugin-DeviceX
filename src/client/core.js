/**
 * Device X browser client — registration and page composition.
 *
 * The editable UI lives in `.tsx` modules under `src/client/components/` plus
 * `page.tsx`; this file only wires the Cordis registration (locale
 * dictionaries, stylesheet, main panel and sidebar entry). It is bundled into
 * `plugin/client.js` by scripts/build-client.mjs.
 */
import { DeviceXIcon, DeviceXPage } from "./page.js";
import { zh, en } from "./dicts.js";
import { STYLE_TEXT } from "./styles.js";
import { NS, PANEL_ID } from "./constants.js";

/**
 * Build the client registration body. Called by `entry.js` after the loader
 * hands over `react` (the JSX/hook runtime reads that injected instance).
 * @returns {{ inject: string[], apply: (ctx: object) => void }}
 */
export function createClient() {
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
