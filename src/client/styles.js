// Generated source split of the Device X client: theme-token stylesheet.
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
.dx-loadingHint { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }

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
.dx-orbit { position: absolute; inset: 0; transform-style: preserve-3d; animation: dx-orbit 26s linear infinite; will-change: transform; }
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
.dx-chipScene { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform-style: preserve-3d; animation: dx-float 7s ease-in-out infinite; will-change: transform; }
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
}
/* The pulse animates opacity (compositor-friendly) on this halo instead of the
 * core's box-shadow, whose per-frame repaint was the scene's biggest CPU cost. */
.dx-chipGlow {
	position: absolute; left: 50%; top: 50%; width: 112px; height: 112px; margin: -56px 0 0 -56px;
	border-radius: 50%;
	background: radial-gradient(closest-side, rgba(56, 189, 248, .6) 0%, rgba(99, 102, 241, .34) 46%, rgba(99, 102, 241, 0) 76%);
	animation: dx-coreGlow 3.2s ease-in-out infinite;
	pointer-events: none;
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
	animation: dx-drift 9s ease-in-out infinite; will-change: transform;
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
.dx-root[data-motion="off"] .dx-scene,
.dx-scene[data-motion="off"] *,
.dx-scene[data-motion="off"] { animation-play-state: paused !important; }

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
/* Mirrors the harness's own switch: the thumb must contrast with the track in
 * BOTH states. label-primary equals brand-primary in the shipped themes, so
 * using it made the knob invisible on an enabled (brand-filled) switch; the
 * theme provides label-primary-foreground for the enabled thumb and
 * switch-thumb for the disabled one. */
.dx-switch {
	position: relative; flex: none; width: 36px; height: 20px; padding: 2px;
	border: 0; border-radius: 999px; cursor: pointer;
	background: var(--dsw-alias-border-l3);
	transition: background-color .18s ease;
}
.dx-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.dx-switch:disabled { cursor: default; opacity: .5; }
.dx-switchThumb {
	display: block; width: 16px; height: 16px; border-radius: 50%;
	background: var(--dsw-alias-label-primary-foreground);
	transition: transform .18s ease, background-color .18s ease;
}
.dx-switch[aria-checked="false"] .dx-switchThumb { background: var(--dsw-alias-switch-thumb); }
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

/* -------------------------------------------------------------- cleanup */
.dx-cleanupTop { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.dx-cleanupTotal { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
.dx-cleanupMeta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-top: 2px; }
.dx-cleanupRows { display: flex; flex-direction: column; margin-top: 10px; }
.dx-cleanRow { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.dx-cleanRow:first-child { border-top: none; }
.dx-cleanCheck { flex: none; width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary); }
.dx-cleanMain { flex: 1 1 auto; min-width: 0; }
.dx-cleanTitle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; min-width: 0; flex-wrap: wrap; }
.dx-cleanPath { color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; margin-top: 2px; }
.dx-cleanSize { flex: none; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; }
.dx-cleanSizeSub { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dx-cleanActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ------------------------------------------------------------ benchmark */
.dx-benchGrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.dx-benchCard {
	display: flex; flex-direction: column; gap: 8px; min-width: 0;
	border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px;
	background: var(--dsw-alias-bg-layer-1);
}
.dx-benchHead { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dx-benchTitle { font-weight: 600; font-size: 12.5px; flex: 1 1 auto; }
.dx-benchScore { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.1; }
.dx-benchUnit { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-left: 4px; }
.dx-benchMeta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.dx-benchFacts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.dx-benchDelta { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-variant-numeric: tabular-nums; flex: none; }
.dx-benchDelta[data-tone="up"] { color: var(--dsw-alias-state-success-primary); }
.dx-benchDelta[data-tone="down"] { color: var(--dsw-alias-state-error-primary); }
.dx-benchDelta[data-tone="flat"] { color: var(--dsw-alias-label-secondary); }

/* ------------------------------------------------------------- keyframes */
@keyframes dx-spin { to { transform: rotate(360deg); } }
@keyframes dx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes dx-fadein { from { opacity: 0; } to { opacity: 1; } }
@keyframes dx-modalin { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes dx-toastin { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes dx-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes dx-orbit { from { transform: rotateX(58deg) rotateZ(0deg); } to { transform: rotateX(58deg) rotateZ(360deg); } }
@keyframes dx-float { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(5px); } }
@keyframes dx-coreGlow { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
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


export { STYLE_TEXT };
