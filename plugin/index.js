/**
 * Device X host half.
 *
 * Owns the device data collectors, the whitelisted device action engine, the
 * browser HTTP API consumed by `client.js`, and the two agent tools. The whole
 * surface is one implementation: the UI routes and the tools call the same
 * functions.
 *
 * @module @cfour-hi/dsh-devicex
 */
import {
  SECTIONS,
  PLATFORM,
  warmup,
  collectMetrics,
  collectSection,
  collectInventory,
} from './host/collector.js';
import { GROUPS, actionCatalog, actionHistory, runAction } from './host/actions.js';
import { scanCleanup } from './host/cleanup.js';
import { runBenchmark } from './host/benchmark.js';
import { registerRoutes } from './host/transport.js';
import { registerTools } from './host/tool.js';

/** Cordis function-plugin name. */
export const name = 'devicex';

/**
 * The route carrier, its trust fence, and the tool registry. All are hard
 * dependencies: without them the plugin has nothing to serve.
 */
export const inject = ['webServer', 'connection', 'tools'];

/** The one shared operation surface both callers use. */
/** @type {import('../types/contracts.js').PluginOperations} */
const operations = {
  SECTIONS,
  PLATFORM,
  GROUPS,
  collectMetrics,
  collectSection,
  collectInventory,
  actionCatalog,
  actionHistory,
  runAction,
  scanCleanup,
  runBenchmark,
};

/**
 * Register the browser API and the agent tools, keeping the slow collectors
 * warm so the first panel view is fast.
 * @param {import('../types/contracts.js').PluginContext} ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  warmup();
  ctx.effect(
    () => registerRoutes(ctx, operations),
    'devicex: browser API routes',
  );
  ctx.effect(
    () => registerTools(ctx, operations),
    'devicex: agent tools',
  );
}
