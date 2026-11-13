/** Device X page: header, tab rail, section bodies, modals and toasts. */
import type { ReactNode } from "react";
import { Fragment, h } from "./jsx.js";
import { useCallback, useEffect, useId, useRef, useState } from "./hooks.js";
import {
  FALLBACK_T,
  asArray,
  asObject,
  fmtTime,
  fmtUptime,
  isIpv4,
  isObj,
  numOr,
  parseServerList,
  safeErrorText,
  strOr,
} from "./helpers.js";
import { mergeHistory, normalizeActions, normalizeFootprint, normalizeHistory, normalizeHistoryEntry } from "./normalizers.js";
import { SECTION_TABS, SIGNALS, TAB_ICONS, TAB_IDS, TAB_LABEL_KEYS } from "./constants.js";
import { api } from "./api.js";
import { actionLabel, optionLabel } from "./action-helpers.js";
import { useDeviceMetrics, usePrefersReducedMotion } from "./use-device-metrics.js";
import { ActionsTab } from "./components/ActionsTab";
import { BenchmarkTab } from "./components/BenchmarkTab";
import { CleanupTab } from "./components/CleanupTab";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { Guard } from "./components/Guard";
import { HardwareTab } from "./components/HardwareTab";
import { Icon } from "./components/Icon";
import { Modal } from "./components/Modal";
import { NetworkTab } from "./components/NetworkTab";
import { OverviewTab } from "./components/OverviewTab";
import { ProcessesTab } from "./components/ProcessesTab";
import { SecurityTab } from "./components/SecurityTab";
import { SoftwareTab } from "./components/SoftwareTab";
import { SystemTab } from "./components/SystemTab";
import { Toasts } from "./components/Toasts";
import { UninstallFootprintModal } from "./components/UninstallFootprintModal";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const SECTION_COMPONENTS: Record<string, any> = {
  hardware: HardwareTab,
  system: SystemTab,
  software: SoftwareTab,
  network: NetworkTab,
  security: SecurityTab,
  processes: ProcessesTab,
};

export interface DeviceXPageProps {
  t?: Translator;
  [key: string]: unknown;
}

export function DeviceXPage(props: DeviceXPageProps) {
  const t = typeof props.t === "function" ? props.t : FALLBACK_T;
  const metricsState = useDeviceMetrics();
  const refreshMetrics = metricsState.refresh;
  const metrics = metricsState.metrics;
  const reducedMotion = usePrefersReducedMotion();
  const [activeTab, setActiveTab] = useState("overview");
  const [threeD, setThreeD] = useState(true);
  const [sections, setSections] = useState({});
  const [catalog, setCatalog] = useState({ status: "idle", actions: [], history: [], platform: null, error: null });
  const [liveHistory, setLiveHistory] = useState([]);
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const sectionsInFlight = useRef({});
  const sectionRetried = useRef({});
  const prefetchStarted = useRef(false);
  const retryTimers = useRef([]);
  const catalogInFlight = useRef(null);
  const toastId = useRef(0);
  const tabRefs = useRef([]);
  const baseId = "dx-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const panelId = baseId + "-panel-" + activeTab;

  const pushToast = useCallback((tone: string, title: string, message: unknown) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((previous: any[]) => previous.concat([{ id, tone, title, message: strOr(message, "") }]).slice(-4));
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((previous: any[]) => previous.filter((toast) => toast.id !== id));
  }, []);

  const appendHistory = useCallback((entry: unknown) => {
    const normalized = normalizeHistoryEntry(entry);
    if (!normalized) return;
    setLiveHistory((previous: any[]) =>
      [normalized]
        .concat(
          asArray(previous).filter(
            (existing: any) =>
              !(existing.ts === normalized.ts && existing.id === normalized.id && existing.message === normalized.message),
          ),
        )
        .slice(0, 50),
    );
  }, []);

  const loadSection = useCallback((section: string, fresh: boolean) => {
    if (!section) return Promise.resolve();
    if (sectionsInFlight.current[section]) return sectionsInFlight.current[section];
    setSections((previous: any) => {
      const existing = asObject(previous[section]);
      return Object.assign({}, previous, {
        [section]: {
          status: "loading",
          data: existing.data === undefined ? null : existing.data,
          error: null,
          fetchedAt: numOr(existing.fetchedAt, 0),
        },
      });
    });
    const promise = api
      .section(section, fresh === true)
      .then((data: any) => {
        setSections((previous: any) => ({
          ...previous,
          [section]: { status: "ready", data: isObj(data) ? data : {}, error: null, fetchedAt: Date.now() },
        }));
      })
      .catch((error: any) => {
        setSections((previous: any) => {
          const existing = asObject(previous[section]);
          return Object.assign({}, previous, {
            [section]: {
              status: "error",
              data: existing.data === undefined ? null : existing.data,
              error,
              fetchedAt: numOr(existing.fetchedAt, 0),
            },
          });
        });
      })
      .finally(() => {
        delete sectionsInFlight.current[section];
      });
    sectionsInFlight.current[section] = promise;
    return promise;
  }, []);

  const invalidateSections = useCallback((exceptSection: string) => {
    setSections((previous: any) => {
      const next: any = {};
      let changed = false;
      for (const key of Object.keys(previous)) {
        if (key === exceptSection) {
          next[key] = previous[key];
          continue;
        }
        if (previous[key].status === "idle") {
          next[key] = previous[key];
          continue;
        }
        next[key] = Object.assign({}, previous[key], { status: "idle" });
        changed = true;
      }
      return changed ? next : previous;
    });
  }, []);

  const loadCatalog = useCallback((fresh: boolean) => {
    if (catalogInFlight.current) return catalogInFlight.current;
    setCatalog((previous: any) => Object.assign({}, previous, { status: previous.actions.length > 0 ? "ready" : "loading", error: null }));
    const promise = api
      .actions()
      .then((result: any) => {
        setCatalog({
          status: "ready",
          actions: normalizeActions(result.actions),
          history: normalizeHistory(result.history),
          platform: typeof result.platform === "string" ? result.platform : null,
          error: null,
        });
      })
      .catch((error: any) => {
        setCatalog((previous: any) => Object.assign({}, previous, { status: previous.actions.length > 0 ? "ready" : "error", error }));
      })
      .finally(() => {
        catalogInFlight.current = null;
      });
    catalogInFlight.current = promise;
    return promise;
  }, []);

  // Lazy section fetch per tab; the cache survives tab switches. A transient
  // failure on the very first (cold) request is retried once automatically.
  useEffect(() => {
    const section = SECTION_TABS[activeTab as keyof typeof SECTION_TABS];
    if (!section) return;
    const current = sections[section];
    if (!current || current.status === "idle") {
      loadSection(section, false);
      return;
    }
    if (current.status === "error" && !current.data && sectionRetried.current[section] !== true) {
      sectionRetried.current[section] = true;
      const timer = setTimeout(() => {
        loadSection(section, true);
      }, 1500);
      retryTimers.current.push(timer);
    }
  }, [activeTab, sections, loadSection]);

  useEffect(() => {
    return () => {
      for (const timer of retryTimers.current) clearTimeout(timer);
      retryTimers.current = [];
    };
  }, []);

  // Warm every section once after the panel appears (Windows first samples are slow).
  useEffect(() => {
    if (prefetchStarted.current) return;
    prefetchStarted.current = true;
    const timers: any[] = [];
    Object.values(SECTION_TABS).forEach((section: any, index: number) => {
      const timer = setTimeout(() => {
        if (!sectionsInFlight.current[section]) loadSection(section, false);
      }, 150 + index * 250);
      timers.push(timer);
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [loadSection]);

  // The catalogue supplies pane allowlists used by other tabs.
  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  const executeAction = useCallback(
    async (actionId: string, params?: Record<string, unknown>) => {
      if (!actionId) return { ok: false, message: "" };
      setPending((previous: any) => Object.assign({}, previous, { [actionId]: true }));
      const label = actionLabel(t, actionId);
      let result: any;
      try {
        result = await api.runAction(actionId, params);
      } catch (error) {
        result = { ok: false, message: safeErrorText(error) };
      }
      try {
        const message = strOr(result.message, "");
        pushToast(result.ok ? "ok" : "fail", t(result.ok ? "toast.action.ok" : "toast.action.fail", { action: label }), message);
        appendHistory({ ts: Date.now(), id: actionId, params: params || {}, ok: result.ok === true, message });
        if (result.ok) {
          const section = SECTION_TABS[activeTab as keyof typeof SECTION_TABS];
          invalidateSections(section);
          if (section) loadSection(section, true);
        }
        refreshMetrics();
      } finally {
        setPending((previous: any) => {
          const next = Object.assign({}, previous);
          delete next[actionId];
          return next;
        });
      }
      return result;
    },
    [t, pushToast, appendHistory, invalidateSections, loadSection, refreshMetrics, activeTab],
  );

  const openConfirm = useCallback((config: Record<string, unknown>) => {
    setModal(Object.assign({ kind: "confirm" }, config));
    setModalError("");
  }, []);
  /**
   * Open the uninstall dialog: scan first, then show what would be removed.
   * A failed or empty scan degrades to the plain confirm so uninstalling is
   * never blocked by the analysis step.
   */
  const openUninstall = useCallback(
    async (target: { path: string; name: string; uninstallId: string }) => {
      setModal({
        kind: "footprint",
        path: strOr(target.path, ""),
        name: strOr(target.name, ""),
        uninstallId: strOr(target.uninstallId, ""),
        status: "loading",
        footprint: null,
        error: "",
      });
      setModalError("");
      let footprint: any = null;
      try {
        const raw = await api.footprint(target.path, false);
        footprint = normalizeFootprint(raw);
      } catch (error) {
        setModal((current: any) =>
          current && current.kind === "footprint" ? Object.assign({}, current, { error: safeErrorText(error) }) : current,
        );
      }
      setModal((current: any) => {
        if (!current || current.kind !== "footprint") return current;
        if (!footprint || footprint.items.length === 0) {
          // Nothing to show: fall back to the ordinary confirmation.
          return {
            kind: "confirm",
            title: t("sw.uninstallTitle", { name: strOr(target.name, "—") }),
            description: strOr(target.uninstallId, "") !== "" ? t("sw.uninstallBodyWin") : t("sw.uninstallBody"),
            confirmLabel: t("sw.uninstall"),
            danger: true,
            actionId: "app.uninstall",
            params: { path: strOr(target.path, ""), id: strOr(target.uninstallId, ""), mode: "trash" },
          };
        }
        // Seed the selection from the default tier immediately: the dialog's
        // checkboxes are uncontrolled by the host, and without this the very
        // first confirm would submit an empty selection while the UI clearly
        // showed items as checked.
        const defaultIds: string[] = [];
        let defaultBytes = 0;
        for (const item of asArray(footprint.items)) {
          const entry = asObject(item);
          if (entry.defaultSelected === true) {
            defaultIds.push(strOr(entry.id, ""));
            defaultBytes += numOr(entry.bytes, 0);
          }
        }
        return Object.assign({}, current, {
          status: "ready",
          footprint,
          selection: { ids: defaultIds, bytes: defaultBytes },
          error: "",
        });
      });
    },
    [t],
  );
  const openDns = useCallback((service: string, servers: unknown) => {
    setModal({
      kind: "dns",
      values: { service: strOr(service, "Wi-Fi"), servers: asArray(servers).filter((entry) => typeof entry === "string").join(", ") },
    });
    setModalError("");
  }, []);
  const openKill = useCallback((target: unknown) => {
    const source = asObject(target);
    setModal({ kind: "kill", pid: numOr(source.pid, 0), name: strOr(source.name, ""), values: { signal: strOr(source.signal, "TERM") } });
    setModalError("");
  }, []);
  const setModalValue = useCallback((name: string, value: unknown) => {
    setModal((previous: any) =>
      previous ? Object.assign({}, previous, { values: Object.assign({}, asObject(previous.values), { [name]: value }) }) : previous,
    );
  }, []);
  const closeModal = useCallback(() => {
    setModal((current: any) => {
      if (modalBusy && current) return current;
      setModalError("");
      return null;
    });
  }, [modalBusy]);

  const resolvePane = useCallback(
    (matchers: unknown, fallback: string) => {
      const openSettings = asArray(catalog.actions).find((action: any) => action.id === "system.openSettings");
      const paneParam = openSettings ? asArray(openSettings.params).find((param: any) => param.name === "pane") : null;
      // The catalogue is the authority on which panes this platform exposes: a
      // pane the host does not list would be rejected as BAD_PARAMS, so the
      // matcher only ever picks from here. Exact ids win over substrings so a
      // short matcher cannot accidentally claim a longer, unrelated pane.
      const options = (paneParam ? asArray(paneParam.options) : []).map((option: any) => String(option));
      const lower = options.map((option: string) => option.toLowerCase());
      const wants = asArray(matchers).map((matcher: any) => String(matcher).toLowerCase());
      for (const needle of wants) {
        const exact = lower.indexOf(needle);
        if (exact >= 0) return options[exact];
      }
      for (const needle of wants) {
        const prefix = lower.findIndex((option: string) => option.startsWith(needle));
        if (prefix >= 0) return options[prefix];
      }
      for (const needle of wants) {
        const partial = lower.findIndex((option: string) => option.indexOf(needle) >= 0);
        if (partial >= 0) return options[partial];
      }
      return fallback;
    },
    [catalog.actions],
  );
  const openPane = useCallback(
    (matchers: string[], fallback: string) => {
      executeAction("system.openSettings", { pane: resolvePane(matchers, fallback) });
    },
    [executeAction, resolvePane],
  );

  const commitModal = useCallback(async () => {
    const current = modal;
    if (!current || modalBusy) return;
    if (current.kind === "dns") {
      const values = asObject(current.values);
      const service = String(values.service === undefined || values.service === null ? "" : values.service).trim();
      const servers = parseServerList(values.servers);
      const invalid = servers.filter((server) => !isIpv4(server));
      if (service.length === 0) {
        setModalError(t("act.invalidRequired", { name: t("net.dnsService") }));
        return;
      }
      if (servers.length > 4 || invalid.length > 0) {
        setModalError(t("net.dnsInvalid"));
        return;
      }
      setModalBusy(true);
      const result = await executeAction("network.setDns", { service, servers });
      setModalBusy(false);
      if (result && result.ok) {
        pushToast("ok", t("net.dnsApplied", { service }), "");
        setModal(null);
        setModalError("");
      } else {
        setModalError(strOr(result && result.message, t("error.sectionHint")));
      }
      return;
    }
    if (current.kind === "footprint") {
      const selection = asObject(current.selection);
      const ids = asArray(selection.ids).filter((entry) => typeof entry === "string");
      const mode = current.uninstallId !== "" ? "win32" : "darwin";
      const params: Record<string, unknown> =
        ids.length > 0
          ? { path: strOr(current.path, ""), mode: "trash", scanId: strOr(asObject(current.footprint).scanId, ""), itemIds: ids, cleanup: "trash" }
          : { path: strOr(current.path, ""), mode: "trash", cleanup: "none" };
      if (mode === "win32") params.id = strOr(current.uninstallId, "");
      setModalBusy(true);
      const result = await executeAction("app.uninstall", params);
      setModalBusy(false);
      if (result && result.ok) {
        setModal(null);
        setModalError("");
      } else {
        setModalError(strOr(result && result.message, t("error.sectionHint")));
      }
      return;
    }
    let actionId = current.actionId;
    let params = current.params;
    if (current.kind === "kill") {
      actionId = "process.signal";
      params = { pid: current.pid, signal: strOr(asObject(current.values).signal, "TERM") };
    }
    if (!actionId) {
      setModal(null);
      return;
    }
    setModalBusy(true);
    await executeAction(actionId, params || {});
    setModalBusy(false);
    setModal(null);
    setModalError("");
  }, [modal, modalBusy, executeAction, pushToast, t]);

  const manualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const section = SECTION_TABS[activeTab as keyof typeof SECTION_TABS];
    const tasks: any[] = [refreshMetrics()];
    if (section) {
      invalidateSections(section);
      tasks.push(loadSection(section, true));
    }
    if (activeTab === "actions" || asArray(catalog.actions).length === 0) tasks.push(loadCatalog(true));
    try {
      await Promise.allSettled(tasks);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, activeTab, refreshMetrics, loadSection, loadCatalog, invalidateSections, catalog.actions]);

  const focusTab = (index: number) => {
    const target = TAB_IDS[index];
    if (!target) return;
    setActiveTab(target);
    const node = tabRefs.current[index];
    if (node && typeof node.focus === "function") {
      try {
        node.focus();
      } catch (_error) {
        /* focus is best-effort */
      }
    }
  };
  const onRailKeyDown = (event: any) => {
    const index = TAB_IDS.indexOf(activeTab);
    if (index < 0) return;
    let next = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % TAB_IDS.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TAB_IDS.length - 1;
    if (next >= 0) {
      event.preventDefault();
      focusTab(next);
    }
  };

  // ---- modal content -------------------------------------------------
  const modalContent = (() => {
    if (!modal) return null;
    if (modal.kind === "dns") {
      const values = asObject(modal.values);
      return {
        title: t("net.dnsTitle"),
        description: t("net.dnsBody", { service: strOr(values.service, "Wi-Fi") }),
        confirmLabel: t("net.setDns"),
        danger: false,
        children: (
          <div className="dx-modalFields">
            <div className="dx-field">
              <label className="dx-fieldLabel" htmlFor={baseId + "-dns-service"}>
                {t("net.dnsService")}
              </label>
              <input
                id={baseId + "-dns-service"}
                type="text"
                className="dx-input"
                value={strOr(values.service, "")}
                placeholder={t("act.paramPlaceholder.service")}
                onChange={(event) => setModalValue("service", event.target.value)}
              />
            </div>
            <div className="dx-field">
              <label className="dx-fieldLabel" htmlFor={baseId + "-dns-servers"}>
                {t("net.dnsServers")}
              </label>
              <textarea
                id={baseId + "-dns-servers"}
                className="dx-textarea"
                value={strOr(values.servers, "")}
                placeholder={t("net.dnsServersPlaceholder")}
                onChange={(event) => setModalValue("servers", event.target.value)}
              />
            </div>
          </div>
        ),
      };
    }
    if (modal.kind === "kill") {
      const signal = strOr(asObject(modal.values).signal, "TERM");
      const pid = numOr(modal.pid, 0);
      const signalAction = asArray(catalog.actions).find((entry: any) => entry.id === "process.signal");
      const signalParam = signalAction ? asArray(signalAction.params).find((param: any) => param.name === "signal") : null;
      const catalogSignals = signalParam ? asArray(signalParam.options).filter((option) => typeof option === "string") : [];
      const killSignals: string[] = catalogSignals.length > 0 ? catalogSignals : (SIGNALS as string[]);
      return {
        title: t("proc.confirmTitle", { name: strOr(modal.name, "—") }),
        description: t("proc.confirmBody", { name: strOr(modal.name, "—"), pid, signal: optionLabel(t, signal) }),
        confirmLabel: t("proc.kill"),
        danger: true,
        children: (
          <div className="dx-modalFields">
            <div className="dx-field">
              <label className="dx-fieldLabel" htmlFor={baseId + "-kill-signal"}>
                {t("proc.signal")}
              </label>
              <select
                id={baseId + "-kill-signal"}
                className="dx-select"
                value={signal}
                onChange={(event) => setModalValue("signal", event.target.value)}
              >
                {killSignals.map((option) => (
                  <option key={option} value={option}>
                    {optionLabel(t, option)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ),
      };
    }
    if (modal.kind === "footprint") {
      const appName = strOr(modal.name, "\u2014");
      if (modal.status === "loading") {
        return {
          title: t("fp.title", { name: appName }),
          description: t("fp.scanning"),
          confirmLabel: t("common.confirm"),
          danger: true,
          busy: true,
          children: null,
        };
      }
      const footprint = asObject(modal.footprint);
      const selection = asObject(modal.selection);
      const selectedIds = asArray(selection.ids).filter((entry) => typeof entry === "string");
      const selectedCount = selectedIds.length;
      return {
        title: t("fp.title", { name: appName }),
        description:
          selectedCount > 0 ? t("fp.confirmBody", { n: selectedCount }) : t("fp.confirmBodyNoCleanup"),
        confirmLabel: selectedCount > 0 ? t("fp.cleanup") : t("fp.cleanupNone"),
        danger: true,
        children: (
          <UninstallFootprintModal
            t={t}
            appName={appName}
            footprint={footprint as any}
            busy={modalBusy}
            notice={strOr(modal.error, "")}
            onSelectionChange={(ids, bytes) => {
              setModal((current: any) =>
                current && current.kind === "footprint"
                  ? Object.assign({}, current, { selection: { ids, bytes } })
                  : current,
              );
            }}
            onOpenCleanup={() => {
              setModal(null);
              setActiveTab("cleanup");
            }}
          />
        ),
      };
    }
    return {
      title: strOr(modal.title, t("dialog.title")),
      description: strOr(modal.description, ""),
      details: asArray(modal.details),
      confirmLabel: strOr(modal.confirmLabel, t("common.confirm")),
      danger: modal.danger === true,
      children: null,
    };
  })();

  // ---- body ----------------------------------------------------------
  const sectionKey = SECTION_TABS[activeTab as keyof typeof SECTION_TABS];
  const sectionState = sectionKey ? sections[sectionKey] || { status: "idle", data: null, error: null } : null;
  const connectionFailed = metricsState.status === "error" && !metrics;
  let body: ReactNode = null;
  if (connectionFailed) {
    body = <ErrorState t={t} title={t("error.title")} text={t("error.body")} onRetry={refreshMetrics} retryLabel={t("common.retry")} />;
  } else if (activeTab === "overview") {
    body = (
      <OverviewTab
        t={t}
        metrics={metrics}
        samples={metricsState.samples}
        threeD={threeD}
        onToggleThreeD={() => setThreeD((value) => !value)}
        onShowProcesses={() => setActiveTab("processes")}
      />
    );
  } else if (activeTab === "actions") {
    body = (
      <ActionsTab
        t={t}
        catalog={catalog}
        history={mergeHistory(liveHistory, catalog.history)}
        pending={pending}
        onRetry={() => loadCatalog(true)}
        openConfirm={openConfirm}
      />
    );
  } else if (activeTab === "cleanup") {
    body = <CleanupTab t={t} onAction={executeAction} />;
  } else if (activeTab === "benchmark") {
    body = <BenchmarkTab t={t} />;
  } else {
    const TabComponent = SECTION_COMPONENTS[activeTab];
    body = TabComponent ? (
      <TabComponent
        t={t}
        state={sectionState}
        metrics={metrics}
        platform={catalog.platform}
        pending={pending}
        onRetry={() => loadSection(activeTab, true)}
        onRefresh={() => loadSection(activeTab, true)}
        onAction={executeAction}
        openConfirm={openConfirm}
        openUninstall={openUninstall}
        openDns={openDns}
        openKill={openKill}
        openPane={openPane}
      />
    ) : (
      <EmptyState title={t("common.empty")} />
    );
  }

  const statusTone = metricsState.status;
  const statusKey =
    statusTone === "ready"
      ? "header.live"
      : statusTone === "stale"
        ? "header.stale"
        : statusTone === "error"
          ? "header.offline"
          : "header.connecting";
  const osChipText = metrics && metrics.osVersion ? metrics.osVersion : catalog.platform === "darwin" ? "macOS" : strOr(catalog.platform, "");

  return (
    <div className="dx-root" data-motion={threeD && !reducedMotion ? "on" : "off"}>
      <header className="dx-header">
        <div className="dx-headerMain">
          <div className="dx-titleRow">
            <h1 className="dx-title" title={metrics && metrics.hostname ? metrics.hostname : t("panel")}>
              {(metrics && metrics.hostname) || t("panel")}
            </h1>
            {osChipText ? <span className="dx-osChip">{osChipText}</span> : null}
          </div>
          <div className="dx-headerMeta">
            <span className="dx-status" data-state={statusTone} role="status" aria-label={t("aria.status")}>
              <span className="dx-statusDot" aria-hidden="true" />
              {t(statusKey)}
            </span>
            {metricsState.updatedAt > 0 ? <span>{t("header.updated", { time: fmtTime(metricsState.updatedAt) })}</span> : null}
            {metrics && metrics.uptimeSec !== null ? <span>{t("header.uptime") + " " + fmtUptime(metrics.uptimeSec, t)}</span> : null}
          </div>
        </div>
        <div className="dx-headerActions">
          <button
            type="button"
            className="dx-iconBtn"
            title={refreshing ? t("header.refreshing") : t("header.refresh")}
            aria-label={t("aria.refresh")}
            disabled={refreshing}
            onClick={manualRefresh}
          >
            <Icon name="refresh" size={15} className={refreshing ? "dx-spin" : undefined} />
          </button>
        </div>
      </header>
      <div className="dx-body">
        <nav className="dx-rail" role="tablist" aria-label={t("aria.tabs")} aria-orientation="vertical" onKeyDown={onRailKeyDown}>
          {TAB_IDS.map((tab, index) => (
            <button
              key={tab}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={baseId + "-tab-" + tab}
              aria-selected={activeTab === tab}
              aria-controls={baseId + "-panel-" + tab}
              tabIndex={activeTab === tab ? 0 : -1}
              className="dx-railTab"
              onClick={() => setActiveTab(tab)}
              onMouseEnter={() => {
                const section = SECTION_TABS[tab as keyof typeof SECTION_TABS];
                if (section && (!sections[section] || sections[section].status === "idle")) loadSection(section, false);
              }}
              onFocus={() => {
                const section = SECTION_TABS[tab as keyof typeof SECTION_TABS];
                if (section && (!sections[section] || sections[section].status === "idle")) loadSection(section, false);
              }}
            >
              <span className="dx-railIcon">
                <Icon name={TAB_ICONS[tab as keyof typeof TAB_ICONS]} size={15} />
              </span>
              <span className="dx-railLabel">{t(TAB_LABEL_KEYS[tab as keyof typeof TAB_LABEL_KEYS])}</span>
            </button>
          ))}
        </nav>
        <div className="dx-contentWrap">
          {metricsState.status === "stale" ? (
            <div className="dx-banner" data-tone="warn" role="status">
              <span className="dx-bannerText">{t("error.stale")}</span>
              <button type="button" className="dx-btn" data-size="sm" onClick={manualRefresh} disabled={refreshing}>
                {t("error.staleRetry")}
              </button>
            </div>
          ) : null}
          <div className="dx-content">
            <div className={activeTab === "processes" || activeTab === "software" ? "dx-tabpanel dx-tabpanelFill" : "dx-tabpanel"} role="tabpanel" id={panelId} aria-labelledby={baseId + "-tab-" + activeTab}>
              <Guard t={t} key={activeTab}>
                {body}
              </Guard>
            </div>
          </div>
        </div>
      </div>
      {modalContent ? (
        <Modal
          t={t}
          title={modalContent.title}
          description={modalContent.description}
          details={modalContent.details}
          confirmLabel={modalContent.confirmLabel}
          danger={modalContent.danger}
          busy={modalBusy}
          errorText={modalError}
          onClose={closeModal}
          onConfirm={commitModal}
        >
          {modalContent.children}
        </Modal>
      ) : null}
      <Toasts t={t} toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/** Sidebar entry glyph: a chip with an X, matching the page artwork. */
export function DeviceXIcon(props: any) {
  const size = numOr(props.size, 18);
  const active = props.active === true;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {active ? <rect x={3.5} y={3.5} width={17} height={17} rx={4.5} fill="currentColor" stroke="none" opacity={0.12} /> : null}
      <rect x={4.5} y={4.5} width={15} height={15} rx={4} />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
      <path d="M9.5 2.5v2M14.5 2.5v2M9.5 19.5v2M14.5 19.5v2M2.5 9.5h2M2.5 14.5h2M19.5 9.5h2M19.5 14.5h2" />
    </svg>
  );
}
