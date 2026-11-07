/** Generic table used by the Hardware/Software/Processes/Network tabs. */
import type { ReactNode } from "react";
import { h, Fragment } from "../jsx.js";
import { asArray, asObject, joinClass, strOr } from "../helpers.js";
import { EmptyState } from "./EmptyState";

export type Translator = (key: string) => string;

export interface DataColumn {
  key: string;
  label: ReactNode;
  render?: (row: any, index: number) => ReactNode;
  className?: string;
  cellClass?: string;
  align?: "right";
}

export interface DataTableProps {
  t?: Translator;
  columns?: DataColumn[];
  rows?: any[];
  rowKey?: (row: any, index: number) => string | number;
  empty?: ReactNode;
  ariaLabel?: string;
}

export function DataTable(props: DataTableProps) {
  const t = props.t || ((key: string) => key);
  const rows = asArray(props.rows) as any[];
  if (rows.length === 0) {
    if (props.empty) return <>{props.empty}</>;
    return <EmptyState title={t("common.empty")} />;
  }
  const columns = asArray(props.columns) as DataColumn[];
  return (
    <div className="dx-tableWrap">
      <table className="dx-table" aria-label={props.ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.className}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={props.rowKey ? props.rowKey(row, index) : index}>
              {columns.map((column) => (
                <td key={column.key} className={joinClass(column.cellClass, column.align === "right" ? "dx-num" : "")}>
                  {column.render ? column.render(row, index) : strOr(asObject(row)[column.key], "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
