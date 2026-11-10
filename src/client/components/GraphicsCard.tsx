/** GPU + display inventory in one card: two columns so the hardware grid
 * cannot stretch two short lists under a tall neighbour (battery health). */
import { h } from "../jsx.js";
import { asArray, fmtBytes, fmtNumber, isFiniteNumber, strOr } from "../helpers.js";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Pill } from "./Pill";
import { SubCard } from "./SubCard";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface GraphicsCardProps {
  t: Translator;
  gpus?: any[];
  displays?: any[];
}

export function GraphicsCard(props: GraphicsCardProps) {
  const t = props.t;
  const gpus = asArray(props.gpus).filter(Boolean);
  const displays = asArray(props.displays).filter(Boolean);
  return (
    <Card title={t("hw.graphics")} icon="gpu" span={2}>
      <div className="dx-duo">
        <div className="dx-duoCol">
          <div className="dx-duoLabel">{t("hw.gpu")}</div>
          {gpus.length === 0 ? (
            <EmptyState title={t("hw.empty")} />
          ) : (
            <div className="dx-sublist">
              {gpus.map((gpu: any, index: number) => (
                <SubCard
                  key={index}
                  title={strOr(gpu.name, "—")}
                  icon="gpu"
                  meta={[
                    isFiniteNumber(gpu.cores) ? t("hw.gpuCores", { n: gpu.cores }) : null,
                    gpu.vramBytes !== null && gpu.vramBytes !== undefined ? t("hw.vram") + " " + fmtBytes(gpu.vramBytes) : null,
                    gpu.vendor ? gpu.vendor : null,
                    gpu.metal ? t("hw.metal") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </div>
          )}
        </div>
        <div className="dx-duoCol">
          <div className="dx-duoLabel">{t("hw.displays")}</div>
          {displays.length === 0 ? (
            <EmptyState title={t("hw.empty")} />
          ) : (
            <div className="dx-sublist">
              {displays.map((display: any, index: number) => (
                <SubCard
                  key={index}
                  title={strOr(display.name, "—")}
                  icon="display"
                  badge={display.main === true ? <Pill tone="brand">{t("hw.main")}</Pill> : null}
                  meta={[
                    display.resolution ? display.resolution : null,
                    isFiniteNumber(display.refreshHz) ? fmtNumber(display.refreshHz) + " Hz" : null,
                    display.connection ? display.connection : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
