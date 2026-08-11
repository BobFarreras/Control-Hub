"use client";

import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  Filter,
  Minus,
  Plus
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { SelectControl } from "@/components/form-field";
import { MetricHelp } from "@/components/metric-help";
import type { TablePreference } from "@/lib/api-types";

export type { TablePreference };
export type SmartColumn<Row> = {
  id: string;
  label: string;
  /** Explains a column whose heading alone is ambiguous, on hover and on focus. */
  help?: string;
  render: (row: Row) => ReactNode;
  width?: number;
  locked?: boolean;
  sort?: { asc: string; desc: string };
  filter?: { parameter: string; options: { value: string; label: string }[] };
};

/**
 * Makes the whole row lead somewhere, given the destination of a row.
 *
 * The cell that carries the link stays a real anchor, so middle-click, right-click and keyboard
 * navigation keep working and the row itself is only a convenience. Without this the clickable
 * area was whatever the name happened to measure: a project called "Marge" gave five letters to
 * aim at, and clicking anywhere else in the row did nothing at all.
 */
export type RowHref<Row> = (row: Row) => string;

export function SmartDataTable<Row extends { id: string }>({
  tableId,
  rows,
  columns,
  preference: initial,
  total,
  page,
  pageSize,
  pageParam,
  pageSizeParam,
  sortParam,
  sort,
  sortOptions,
  empty,
  labels,
  primaryControls,
  rowHref
}: {
  tableId: string;
  rows: Row[];
  columns: SmartColumn<Row>[];
  preference: TablePreference;
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
  pageParam: string;
  pageSizeParam: string;
  sortParam: string;
  sort: string;
  sortOptions: { value: string; label: string }[];
  empty: string;
  labels: Record<string, string>;
  primaryControls?: ReactNode;
  /** When given, the whole row leads there. The anchor inside the row stays the real link. */
  rowHref?: RowHref<Row>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preference, setPreference] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ordered = useMemo(() => {
    const rank = new Map(preference.columnOrder.map((id, index) => [id, index]));
    return [...columns]
      .sort((a, b) => (rank.get(a.id) ?? columns.indexOf(a)) - (rank.get(b.id) ?? columns.indexOf(b)))
      .filter((column) => !preference.hiddenColumns.includes(column.id));
  }, [columns, preference]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  function query(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.push(`?${next.toString()}`, { scroll: false });
  }
  async function persist(next: TablePreference) {
    setPreference(next);
    setSaving(true);
    const response = await fetch(`/api/v1/table-preferences/${tableId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    setSaving(false);
    if (!response.ok) setPreference(preference);
  }
  function move(id: string, direction: -1 | 1) {
    const ids = columns
      .map((column) => column.id)
      .sort(
        (a, b) =>
          (preference.columnOrder.indexOf(a) < 0
            ? columns.findIndex((item) => item.id === a)
            : preference.columnOrder.indexOf(a)) -
          (preference.columnOrder.indexOf(b) < 0
            ? columns.findIndex((item) => item.id === b)
            : preference.columnOrder.indexOf(b))
      );
    const index = ids.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void persist({ ...preference, columnOrder: ids });
  }
  function toggle(column: SmartColumn<Row>) {
    if (column.locked) return;
    const hiddenColumns = preference.hiddenColumns.includes(column.id)
      ? preference.hiddenColumns.filter((id) => id !== column.id)
      : [...preference.hiddenColumns, column.id];
    void persist({ ...preference, hiddenColumns });
  }
  function resize(column: SmartColumn<Row>, delta: number) {
    const width = Math.min(600, Math.max(80, (preference.columnWidths[column.id] ?? column.width ?? 160) + delta));
    void persist({ ...preference, columnWidths: { ...preference.columnWidths, [column.id]: width } });
  }
  return (
    <div className="smart-table">
      <div className="smart-table-controls">
        <div className="smart-table-primary">{primaryControls}</div>
        <div className="smart-table-settings">
          <label>
            {labels.sort}
            <SelectControl
              value={sort}
              onChange={(event) => query({ [sortParam]: event.target.value, [pageParam]: "1" })}
              options={[
                ...(!sortOptions.some((option) => option.value === sort) ? [{ value: sort, label: labels.sort ?? "Sort" }] : []),
                ...sortOptions.map((option) => ({ value: option.value, label: option.label }))
              ]}
            />
          </label>
          <details>
            <summary>
              <Columns3 size={16} />
              {labels.columns}
            </summary>
            <div className="column-menu">
              {columns.map((column) => (
                <div key={column.id}>
                  <button
                    className="icon-button"
                    disabled={saving || column.locked}
                    onClick={() => toggle(column)}
                    aria-label={`${labels.visibility}: ${column.label}`}
                    title={labels.visibility}
                  >
                    {preference.hiddenColumns.includes(column.id) ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <span>{column.label}</span>
                  <button
                    className="icon-button"
                    disabled={saving}
                    onClick={() => resize(column, -20)}
                    aria-label={`${labels.narrower}: ${column.label}`}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={saving}
                    onClick={() => resize(column, 20)}
                    aria-label={`${labels.wider}: ${column.label}`}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={saving}
                    onClick={() => move(column.id, -1)}
                    aria-label={`${labels.moveUp}: ${column.label}`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={saving}
                    onClick={() => move(column.id, 1)}
                    aria-label={`${labels.moveDown}: ${column.label}`}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              {ordered.map((column) => {
                const descending = column.sort && sort === column.sort.desc;
                const sorting = column.sort && (sort === column.sort.asc || descending);
                return (
                  <th style={{ width: preference.columnWidths[column.id] ?? column.width }} key={column.id}>
                    <div className="column-heading">
                      {column.help ? (
                        <MetricHelp label={column.label} description={column.help} />
                      ) : (
                        <span>{column.label}</span>
                      )}
                      {column.sort && (
                        <div className="column-sort">
                          <button
                            className={sorting ? "active" : ""}
                            onClick={() =>
                              query({
                                [sortParam]: descending ? column.sort!.asc : column.sort!.desc,
                                [pageParam]: "1"
                              })
                            }
                            aria-label={`${labels.sort}: ${column.label}`}
                          >
                            {descending ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
                          </button>
                        </div>
                      )}
                      {column.filter && (
                        <details className="column-filter">
                          <summary
                            className={searchParams.has(column.filter.parameter) ? "active" : ""}
                            aria-label={`${labels.filter}: ${column.label}`}
                          >
                            <Filter size={13} />
                            <ChevronDown size={11} />
                          </summary>
                          <div>
                            <button
                              className={!searchParams.has(column.filter.parameter) ? "active" : ""}
                              onClick={(event) => {
                                event.currentTarget.closest("details")?.removeAttribute("open");
                                query({ [column.filter!.parameter]: null, [pageParam]: "1" });
                              }}
                            >
                              {labels.all}
                            </button>
                            {column.filter.options.map((option) => (
                              <button
                                className={searchParams.get(column.filter!.parameter) === option.value ? "active" : ""}
                                onClick={(event) => {
                                  event.currentTarget.closest("details")?.removeAttribute("open");
                                  query({ [column.filter!.parameter]: option.value, [pageParam]: "1" });
                                }}
                                key={option.value}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody key={`${sort}:${rows.map((row) => row.id).join(":")}`}>
            {rows.map((row, index) => {
              const href = rowHref?.(row);
              return (
                <tr
                  className={href ? "smart-table-row navigable" : "smart-table-row"}
                  data-row-id={row.id}
                  style={{ "--row-index": index } as CSSProperties}
                  key={row.id}
                  // A click that landed on a link, a button or a text selection is left alone:
                  // otherwise selecting a cell to copy it would navigate away instead.
                  onClick={(event) => {
                    if (!href) return;
                    const target = event.target as HTMLElement;
                    if (target.closest("a, button, input, select, textarea, summary, label")) return;
                    if (window.getSelection()?.toString()) return;
                    router.push(href);
                  }}
                >
                  {ordered.map((column) => (
                    <td key={column.id}>{column.render(row)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="crm-empty">{empty}</p>}
      </div>
      <footer className="table-pagination">
        <span>
          {total} {labels.results}
        </span>
        <label>
          {labels.rows}
          <SelectControl
            value={String(pageSize)}
            onChange={(event) => {
              const nextPageSize = Number(event.target.value) as TablePreference["pageSize"];
              void persist({ ...preference, pageSize: nextPageSize });
              query({ [pageSizeParam]: String(nextPageSize), [pageParam]: "1" });
            }}
            options={[10, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))}
          />
        </label>
        <span>
          {page} / {pages}
        </span>
        <button
          className="icon-button"
          disabled={page <= 1}
          onClick={() => query({ [pageParam]: String(page - 1) })}
          aria-label={labels.previous}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          disabled={page >= pages}
          onClick={() => query({ [pageParam]: String(page + 1) })}
          aria-label={labels.nextPage}
        >
          <ChevronRight size={17} />
        </button>
      </footer>
    </div>
  );
}
