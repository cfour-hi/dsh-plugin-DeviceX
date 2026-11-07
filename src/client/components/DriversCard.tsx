/** Read-only driver/kext inventory card with a local search filter. */
import { h } from "../jsx.js";
import { asArray, asObject, isObj, numOrNull, strOr } from "../helpers.js";
import { useState } from "../hooks.js";
import { Card } from "./Card";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { Pill } from "./Pill";
import { SearchField } from "./SearchField";
import { SubCard } from "./SubCard";

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface DriversCardProps {
  t: Translator;
  drivers?: any[];
  summary?: any;
  problems?: any[];
}

export function DriversCard(props: DriversCardProps) {
  const t = props.t;
  const [query, setQuery] = useState("");
  const drivers = asArray(props.drivers).filter(isObj);
  const summary = asObject(props.summary);
  const problems = asArray(props.problems).filter(isObj).slice(0, 20);
  if (drivers.length === 0) {
    return (
      <Card title={t("hw.drivers.title")} icon="gear" subtitle={t("hw.drivers.subtitle")} span={2}>
        <EmptyState icon="gear" title={t("hw.drivers.none")} />
      </Card>
    );
  }
  const needle = String(query).trim().toLowerCase();
  const matched = needle
    ? drivers.filter((driver: any) =>
        [driver.name, driver.class, driver.manufacturer, driver.signer, driver.deviceId, driver.bundleId].some(
          (value) => typeof value === "string" && value.toLowerCase().indexOf(needle) >= 0,
        ),
      )
    : drivers;
  const rows = matched.slice(0, 60);
  const total = numOrNull(summary.total) ?? drivers.length;
  const badges = [
    <Pill key="total" tone="idle">
      {t("hw.drivers.total", { n: total })}
    </Pill>,
    numOrNull(summary.thirdParty) ? (
      <Pill key="third" tone="brand">
        {t("hw.drivers.thirdParty", { n: summary.thirdParty })}
      </Pill>
    ) : null,
    numOrNull(summary.problems) && summary.problems > 0 ? (
      <Pill key="problems" tone="error">
        {t("hw.drivers.problems", { n: summary.problems })}
      </Pill>
    ) : null,
  ].filter(Boolean);
  return (
    <Card
      title={t("hw.drivers.title")}
      icon="gear"
      subtitle={t("hw.drivers.subtitle")}
      span={2}
      actions={
        <div style={{ width: "190px" }}>
          <SearchField value={String(query)} placeholder={t("hw.drivers.search")} label={t("hw.drivers.search")} onChange={setQuery} />
        </div>
      }
    >
      <div className="dx-tagList" style={{ marginBottom: "10px" }}>
        {badges}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="search" title={t("hw.drivers.noMatch")} />
      ) : (
        <DataTable
          t={t}
          columns={[
            { key: "name", label: t("hw.drivers.name"), render: (row: any) => strOr(row.name, strOr(row.bundleId, "—")) },
            { key: "class", label: t("hw.drivers.class"), render: (row: any) => strOr(row.class, strOr(row.kind, "—")) },
            { key: "vendor", label: t("hw.drivers.vendor"), render: (row: any) => strOr(row.manufacturer, "—") },
            { key: "version", label: t("hw.drivers.version"), render: (row: any) => strOr(row.version, "—") },
            { key: "date", label: t("hw.drivers.date"), render: (row: any) => strOr(row.date, "—") },
            { key: "signer", label: t("hw.drivers.signer"), render: (row: any) => strOr(row.signer, "—") },
          ]}
          rows={rows}
        />
      )}
      {matched.length > rows.length ? (
        <p className="dx-small dx-muted" style={{ marginTop: "8px" }}>
          {"… " + String(matched.length - rows.length)}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <div style={{ marginTop: "12px" }}>
          <div className="dx-factLabel" style={{ marginBottom: "6px" }}>
            {t("hw.drivers.problems", { n: problems.length })}
          </div>
          <div className="dx-sublist">
            {problems.map((problem: any, index: number) => (
              <SubCard
                key={index}
                title={strOr(problem.name, "—")}
                icon="warning"
                badge={
                  <Pill tone="error">{t("hw.drivers.problemCode", { code: strOr(problem.code, "?") })}</Pill>
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      <p className="dx-small dx-muted" style={{ marginTop: "10px" }}>
        {t("hw.drivers.readOnly")}
      </p>
    </Card>
  );
}
