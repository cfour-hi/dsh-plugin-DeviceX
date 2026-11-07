/** Benchmark tab: run the fixed-work suite and compare with the previous run. */
import { Fragment, h } from "../jsx.js";
import { api } from "../api.js";
import { asArray, asObject, fmtBytes, fmtMs, fmtNumber, isFiniteNumber, safeErrorText, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { BenchmarkDelta } from "./BenchmarkDelta";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Icon } from "./Icon";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const BENCH_LABEL_KEYS: Record<string, string> = { cpu: "bench.cpu", memory: "bench.memory", disk: "bench.disk" };
const BENCH_ICONS: Record<string, string> = { cpu: "cpu", memory: "memory", disk: "disk" };

export interface BenchmarkTabProps {
  t: Translator;
}

export function BenchmarkTab(props: BenchmarkTabProps) {
  const t = props.t;
  const [state, setState] = useState({ status: "idle", run: null, error: null });
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (running) return;
    setRunning(true);
    setState((previous: any) => ({ status: previous.run ? "ready" : "loading", run: previous.run, error: null }));
    const result = await api.benchmark({});
    setRunning(false);
    if (!result.ok || !result.benchmark) {
      setState((previous: any) => ({
        status: previous.run ? "ready" : "error",
        run: previous.run,
        error: new Error(result.message || "benchmark failed"),
      }));
      return;
    }
    setState({ status: "ready", run: result.benchmark, error: null });
  };
  const runData = state.run;
  const previousScores: Record<string, any> = {};
  if (runData && runData.previous) {
    for (const entry of asArray(runData.previous.results)) previousScores[strOr(entry.id, "")] = entry;
  }
  const results = runData ? asArray(runData.results) : [];
  const env = runData ? asObject(runData.environment) : {};
  return (
    <div className="dx-section">
      <Card
        title={t("tab.benchmark")}
        icon="spark"
        subtitle={t("bench.intro")}
        actions={
          <button
            type="button"
            className="dx-btn"
            data-variant="primary"
            data-size="sm"
            onClick={run}
            disabled={running}
          >
            <Icon name="spark" size={13} />
            {running ? t("bench.running") : runData ? t("bench.rerun") : t("bench.run")}
          </button>
        }
      >
        {running ? (
          <p className="dx-small dx-muted" role="status">
            {t("bench.runningHint")}
          </p>
        ) : null}
        {state.status === "error" && !runData ? (
          <ErrorState t={t} title={t("error.section")} text={safeErrorText(state.error)} onRetry={run} retryLabel={t("common.retry")} />
        ) : null}
        {!runData && state.status !== "error" ? <EmptyState icon="spark" title={t("bench.empty")} /> : null}
        {results.length > 0 ? (
          <div className="dx-benchGrid">
            {results.map((result: any) => {
              const details = asObject(result.details);
              const previous = previousScores[result.id];
              return (
                <div className="dx-benchCard" key={result.id}>
                  <div className="dx-benchHead">
                    <Icon name={BENCH_ICONS[result.id] || "spark"} size={15} />
                    <span className="dx-benchTitle">{t(BENCH_LABEL_KEYS[result.id] || "bench.cpu")}</span>
                    <BenchmarkDelta t={t} previous={previous} score={result.score} />
                  </div>
                  {result.error ? (
                    <div className="dx-small" style={{ color: "var(--dsw-alias-state-error-primary)" }}>
                      {t("bench.failed", { message: result.error })}
                    </div>
                  ) : (
                    <Fragment>
                      <div>
                        <span className="dx-benchScore">
                          {result.score === null ? "—" : fmtNumber(result.score, result.score < 100 ? 1 : 0)}
                        </span>
                        <span className="dx-benchUnit">{result.unit}</span>
                      </div>
                      <div className="dx-benchMeta">{t("bench.duration", { value: fmtMs(result.durationMs) })}</div>
                      {result.id === "cpu" ? (
                        <div className="dx-benchFacts">
                          {isFiniteNumber(asObject(details.singleThread).score) ? (
                            <span className="dx-benchMeta" key="single">
                              {t("bench.single") + ": " + fmtNumber(asObject(details.singleThread).score, 0) + " ops/s"}
                            </span>
                          ) : null}
                          {isFiniteNumber(asObject(details.multiThread).score) ? (
                            <span className="dx-benchMeta" key="multi">
                              {t("bench.multi") +
                                ": " +
                                fmtNumber(asObject(details.multiThread).score, 0) +
                                " ops/s" +
                                (isFiniteNumber(asObject(details.multiThread).threads)
                                  ? " · " + t("bench.threads", { n: asObject(details.multiThread).threads })
                                  : "")}
                            </span>
                          ) : null}
                        </div>
                      ) : result.id === "disk" ? (
                        <div className="dx-benchFacts">
                          {isFiniteNumber(details.writeMBps) ? (
                            <span className="dx-benchMeta" key="write">
                              {t("bench.write") + ": " + fmtNumber(details.writeMBps, 1) + " MB/s"}
                            </span>
                          ) : null}
                          {isFiniteNumber(details.readMBps) ? (
                            <span className="dx-benchMeta" key="read">
                              {t("bench.read") + ": " + fmtNumber(details.readMBps, 1) + " MB/s"}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="dx-benchFacts">
                          {isFiniteNumber(details.megabytes) ? (
                            <span className="dx-benchMeta" key="bytes">
                              {fmtBytes(details.megabytes * 1024 * 1024)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </Fragment>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
        {runData ? (
          <div className="dx-benchFacts" style={{ marginTop: "14px" }}>
            {env.cpuModel ? <span className="dx-benchMeta">{env.cpuModel}</span> : null}
            {isFiniteNumber(env.logicalCores) ? (
              <span className="dx-benchMeta">{t("bench.cores", { n: env.logicalCores })}</span>
            ) : null}
            {isFiniteNumber(env.memoryBytes) ? (
              <span className="dx-benchMeta">{t("bench.memoryTotal", { value: fmtBytes(env.memoryBytes) })}</span>
            ) : null}
            {env.osVersion ? <span className="dx-benchMeta">{env.osVersion}</span> : null}
            {isFiniteNumber(runData.durationMs) ? (
              <span className="dx-benchMeta">{t("bench.totalDuration", { value: fmtMs(runData.durationMs) })}</span>
            ) : null}
          </div>
        ) : null}
        {runData && runData.previous === null ? (
          <p className="dx-small dx-muted" style={{ marginTop: "8px" }}>
            {t("bench.noPrevious")}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
