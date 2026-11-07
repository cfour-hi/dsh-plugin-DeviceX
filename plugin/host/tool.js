/**
 * Agent-facing Device X tools. Both tools call the same shared operation
 * surface as the browser API, so the model and the UI can never disagree
 * about what an action does.
 *
 * @module @local/dsh-devicex/host/tool
 */

/** Sections the read tool accepts, in UI order. */
const READ_SECTIONS = [
  'overview',
  'hardware',
  'system',
  'software',
  'network',
  'security',
  'processes',
];

/** Human byte size helper shared by the tool summaries. */
function humanBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Build a compact one-line summary from the fast metrics payload. */
function summarize(metrics) {
  const parts = [];
  if (typeof metrics?.hostname === 'string') parts.push(metrics.hostname);
  if (typeof metrics?.osVersion === 'string') parts.push(metrics.osVersion);
  if (typeof metrics?.cpu?.usagePercent === 'number') {
    parts.push(`CPU ${metrics.cpu.usagePercent.toFixed(0)}%`);
  }
  if (typeof metrics?.memory?.totalBytes === 'number') {
    const used = metrics.memory.usedBytes ?? 0;
    parts.push(`RAM ${humanBytes(used)}/${humanBytes(metrics.memory.totalBytes)}`);
  }
  if (typeof metrics?.disk?.totalBytes === 'number') {
    const used = metrics.disk.usedBytes ?? 0;
    parts.push(`Disk ${humanBytes(used)}/${humanBytes(metrics.disk.totalBytes)}`);
  }
  if (metrics?.battery?.present === true) parts.push(`Battery ${metrics.battery.percent}%`);
  if (typeof metrics?.uptimeSec === 'number') {
    parts.push(`Uptime ${(metrics.uptimeSec / 3600).toFixed(1)}h`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'device metrics unavailable';
}

/** Cap the JSON a tool result hands to the model. */
function capJson(value, budget = 24000) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    return '(value could not be serialized)';
  }
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n… (truncated; request a specific section for full data)`;
}

/**
 * Register both tools on the plugin's context.
 * @param ctx - the plugin context carrying the `tools` service.
 * @param operations - the shared operation surface.
 * @returns an array of disposers removing the registrations.
 */
export function registerTools(ctx, operations) {
  const actionIds = operations.actionCatalog().map((entry) => entry.id);

  const info = {
    name: 'device_info',
    description:
      'Read this machine\'s device facts: hardware (CPU, memory, GPU, displays, storage, battery, USB, Bluetooth, audio, cameras), system (OS, kernel, boot, users, launch agents), software (installed applications, Homebrew), network (interfaces, Wi-Fi, DNS, routes, listening ports), security (FileVault, SIP, Gatekeeper, firewall, permissions), and processes. ' +
      'Use section="overview" (default) for a fast health summary, or one of ' +
      READ_SECTIONS.join('/') +
      ' for details. Set fresh=true to bypass the collector cache.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        section: {
          type: 'string',
          enum: READ_SECTIONS,
          description: 'Which slice of the device to read. Defaults to overview.',
        },
        fresh: {
          type: 'boolean',
          description: 'Bypass the section cache and re-collect now.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: { type: 'string' },
          summary: { type: 'string' },
          data: { description: 'The section payload (JSON).' },
        },
        required: ['section', 'summary', 'data'],
      },
      render(_args, value) {
        return [
          { type: 'text', text: value.summary },
          { type: 'text', text: capJson(value.data) },
        ];
      },
    },
    async execute(args) {
      const section = typeof args.section === 'string' ? args.section : 'overview';
      if (!READ_SECTIONS.includes(section)) {
        throw new Error(`unknown section: ${section}`);
      }
      const fresh = args.fresh === true;
      if (section === 'overview') {
        const metrics = await operations.collectMetrics();
        const catalog = operations.actionCatalog();
        const data = {
          metrics,
          hostname: metrics?.hostname ?? null,
          osVersion: metrics?.osVersion ?? null,
          uptimeSec: metrics?.uptimeSec ?? null,
          availableActions: catalog.map((entry) => entry.id),
        };
        return { section, summary: summarize(metrics), data };
      }
      const data = await operations.collectSection(section, { fresh });
      const metrics = await operations.collectMetrics();
      return { section, summary: `${section} · ${summarize(metrics)}`, data };
    },
  };

  const control = {
    name: 'device_control',
    description:
      'Operate this machine: signal/kill processes, quit or launch applications, uninstall applications (trash or delete), manage launch agents, change host name / volume / dark mode, toggle Wi-Fi or the firewall, set DNS servers, uninstall Homebrew formulas, flush DNS, empty the trash, sleep or lock the screen, and open System Settings panes. ' +
      'Every operation is a whitelisted action with strict parameter validation — there is no arbitrary shell execution. ' +
      'Available actions: ' +
      actionIds.join(', ') +
      '. High-danger actions (uninstall, kill, host name, firewall, DNS) are irreversible: confirm with the user and state what you are about to do before calling them.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: actionIds,
          description: 'The action id to run.',
        },
        params: {
          type: 'object',
          additionalProperties: true,
          description:
            'Action-specific parameters (see device_info action catalog or the Device X 操作 page). Omit for actions with no parameters.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          message: { type: 'string' },
          data: { description: 'Optional action payload.' },
        },
        required: ['ok', 'message'],
      },
      render(_args, value) {
        const head = value.ok ? `OK: ${value.message}` : `FAILED: ${value.message}`;
        return [
          { type: 'text', text: head },
          ...(value.data === undefined
            ? []
            : [{ type: 'text', text: capJson(value.data, 8000) }]),
        ];
      },
    },
    async execute(args) {
      if (typeof args.action !== 'string' || !actionIds.includes(args.action)) {
        throw new Error(`unknown device action: ${String(args.action)}`);
      }
      const params = typeof args.params === 'object' && args.params !== null ? args.params : {};
      return operations.runAction(args.action, params);
    },
  };

  return [ctx.tools.register(info), ctx.tools.register(control)];
}
