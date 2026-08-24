"use client";

import { AlertTriangle, CheckCircle2, CircleDollarSign, Database, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type {
  TablePreference,
  UsageBudget,
  UsageBudgetEvaluation,
  UsageCost,
  UsageEvent,
  UsageSource
} from "@/lib/api-types";
import { budgetIssue, coverageTone, money, quantityTotal, usageCoverage } from "@/lib/usage";

type Mode = "overview" | "costs" | "budgets";
type UsageLabels = Record<string, string> & {
  sections: string;
  overview: string;
  costs: string;
  budgets: string;
  recent: string;
  date: string;
  sku: string;
  operation: string;
  volume: string;
  evidence: string;
  adjustment: string;
  coverage: string;
  originalCost: string;
  reportCost: string;
  currency: string;
  name: string;
  limit: string;
  period: string;
  spent: string;
  actions: string;
  notEvaluated: string;
  evaluate: string;
  events: string;
  priced: string;
  needsAttention: string;
  restrictedTitle: string;
  restrictedBody: string;
  totalVolume: string;
  emptyEvents: string;
  emptyCosts: string;
  emptyBudgets: string;
  missingValuations: string;
  staleSources: string;
  sources: string;
  neverCompleted: string;
  lastComplete: string;
};
type Props = {
  mode: Mode;
  locale: string;
  labels: UsageLabels;
  events: UsageEvent[];
  costs: UsageCost[];
  budgets: UsageBudget[];
  sources: UsageSource[];
  canSeeCosts: boolean;
  canManageBudgets: boolean;
  preference: TablePreference;
};
const pill = (text: string, tone: string) => <span className={`status-pill ${tone}`}>{text}</span>;

export function UsageWorkspace(props: Props) {
  const { mode, locale, labels, events, costs, budgets, sources, canSeeCosts, canManageBudgets, preference } = props;
  const [evaluations, setEvaluations] = useState<Record<string, UsageBudgetEvaluation>>({});
  const [pending, setPending] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const requestedSize = Number(searchParams.get("pageSize"));
  const pageSize = ([10, 25, 50, 100] as const).includes(requestedSize as 10 | 25 | 50 | 100)
    ? (requestedSize as 10 | 25 | 50 | 100)
    : preference.pageSize;
  const coverage = usageCoverage(events, costs);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const nav = (
    <div className="segmented-control" aria-label={labels.sections}>
      <Link className={mode === "overview" ? "active" : ""} href={`/${locale}/usage`}>
        {labels.overview}
      </Link>
      <Link className={mode === "costs" ? "active" : ""} href={`/${locale}/usage/costs`}>
        {labels.costs}
      </Link>
      <Link className={mode === "budgets" ? "active" : ""} href={`/${locale}/usage/budgets`}>
        {labels.budgets}
      </Link>
    </div>
  );
  const totalForMode = mode === "overview" ? events.length : mode === "costs" ? costs.length : budgets.length;
  const pages = Math.max(1, Math.ceil(totalForMode / pageSize));
  const page = Math.min(Math.max(1, Number(searchParams.get("page")) || 1), pages);
  const window = <Row,>(rows: Row[]) => rows.slice((page - 1) * pageSize, page * pageSize);
  const common = {
    preference,
    page,
    pageSize,
    pageParam: "page",
    pageSizeParam: "pageSize",
    sortParam: "sort",
    sort: "recent",
    sortOptions: [{ value: "recent", label: labels.recent }],
    labels,
    primaryControls: nav
  };
  const eventColumns: SmartColumn<UsageEvent>[] = [
    {
      id: "occurredAt",
      label: labels.date,
      locked: true,
      render: (row) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(row.occurredAt))
    },
    { id: "sku", label: labels.sku, render: (row) => <strong>{row.sku}</strong> },
    { id: "operation", label: labels.operation, render: (row) => row.operation },
    {
      id: "quantities",
      label: labels.volume,
      render: (row) => row.quantities.map((q) => `${q.quantity} ${q.unit}`).join(" · ")
    },
    {
      id: "status",
      label: labels.evidence,
      render: (row) =>
        pill(labels[`event_${row.status}`] ?? row.status, row.status === "void" ? "tone-done" : "tone-active")
    }
  ];
  const costColumns: SmartColumn<UsageCost>[] = [
    {
      id: "event",
      label: labels.sku,
      locked: true,
      render: (row) => eventById.get(row.eventId ?? "")?.sku ?? labels.adjustment
    },
    {
      id: "state",
      label: labels.coverage,
      render: (row) => pill(labels[`cost_${row.state}`] ?? row.state, coverageTone(row.state))
    },
    {
      id: "original",
      label: labels.originalCost,
      render: (row) => (row.originalCurrency ? money(row.originalCostMinor, row.originalCurrency, locale) : "—")
    },
    { id: "report", label: labels.reportCost, render: (row) => money(row.reportCostMinor, row.reportCurrency, locale) },
    { id: "currency", label: labels.currency, render: (row) => row.reportCurrency }
  ];
  async function evaluate(id: string) {
    setPending(id);
    try {
      const response = await fetch(`/api/v1/usage/budgets/${id}/evaluate`, { method: "POST" });
      if (response.ok) {
        const evaluation = (await response.json()) as UsageBudgetEvaluation;
        setEvaluations((current) => ({ ...current, [id]: evaluation }));
      }
    } finally {
      setPending(null);
    }
  }
  const budgetColumns: SmartColumn<UsageBudget>[] = [
    { id: "name", label: labels.name, locked: true, render: (row) => <strong>{row.name}</strong> },
    { id: "limit", label: labels.limit, render: (row) => money(row.amountMinor, row.currency, locale) },
    { id: "period", label: labels.period, render: (row) => labels[`period_${row.period}`] ?? row.period },
    {
      id: "coverage",
      label: labels.coverage,
      render: (row) => {
        const evaluation = evaluations[row.id];
        const state = evaluation?.state;
        const issue = evaluation ? budgetIssue(evaluation) : null;
        return state ? (
          <span>
            {pill(
              labels[`budget_${state}`] ?? state,
              state === "healthy" ? "tone-active" : state === "warning" ? "tone-warning" : "tone-danger"
            )}
            {issue && (
              <small>
                {(issue.kind === "sources" ? labels.staleSources : labels.missingValuations).replace(
                  "{count}",
                  String(issue.count)
                )}
              </small>
            )}
          </span>
        ) : (
          <span>{labels.notEvaluated}</span>
        );
      }
    },
    {
      id: "spent",
      label: labels.spent,
      render: (row) => (evaluations[row.id] ? money(evaluations[row.id]!.spentMinor, row.currency, locale) : "—")
    },
    ...(canManageBudgets
      ? [
          {
            id: "action",
            label: labels.actions,
            render: (row) => (
              <button className="secondary-action" disabled={pending === row.id} onClick={() => void evaluate(row.id)}>
                <RefreshCw size={15} />
                {labels.evaluate}
              </button>
            )
          } satisfies SmartColumn<UsageBudget>
        ]
      : [])
  ];
  if (mode === "overview")
    return (
      <div className="usage-stack">
        <section className="commerce-summary-strip usage-summary">
          <article>
            <Database size={19} />
            <div>
              <span>{labels.sources}</span>
              <strong>{sources.length}</strong>
            </div>
          </article>
          <article>
            <CircleDollarSign size={19} />
            <div>
              <span>{labels.coverage}</span>
              <strong>{coverage.percent}%</strong>
            </div>
          </article>
          <article>
            <CheckCircle2 size={19} />
            <div>
              <span>{labels.priced}</span>
              <strong>{coverage.priced}</strong>
            </div>
          </article>
          <article>
            <AlertTriangle size={19} />
            <div>
              <span>{labels.needsAttention}</span>
              <strong>{coverage.partial + coverage.unpriced}</strong>
            </div>
          </article>
        </section>
        {!canSeeCosts && (
          <div className="notice notice-warning">
            <AlertTriangle size={18} />
            <span>
              <strong>{labels.restrictedTitle}</strong> {labels.restrictedBody}
            </span>
          </div>
        )}
        <section className="panel usage-sources">
          <div className="panel-heading">
            <strong>{labels.sources}</strong>
          </div>
          {sources.length === 0 ? (
            <p className="crm-empty">{labels.neverCompleted}</p>
          ) : (
            <ul>
              {sources.map((source) => (
                <li key={source.id}>
                  <strong>{source.operation}</strong>
                  <span>
                    {source.lastCompleteAt
                      ? `${labels.lastComplete}: ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(source.lastCompleteAt))}`
                      : labels.neverCompleted}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span>{labels.totalVolume}</span>
              <strong>{quantityTotal(events).toString()}</strong>
            </div>
          </div>
          <SmartDataTable
            tableId="usage.events"
            rows={window(events)}
            columns={eventColumns}
            total={events.length}
            empty={labels.emptyEvents}
            {...common}
          />
        </section>
      </div>
    );
  if (mode === "costs")
    return !canSeeCosts ? (
      <div className="notice notice-warning">
        <AlertTriangle size={18} />
        <span>
          <strong>{labels.restrictedTitle}</strong> {labels.restrictedBody}
        </span>
      </div>
    ) : (
      <SmartDataTable
        tableId="usage.costs"
        rows={window(costs)}
        columns={costColumns}
        total={costs.length}
        empty={labels.emptyCosts}
        {...common}
      />
    );
  if (!canSeeCosts)
    return (
      <div className="notice notice-warning">
        <AlertTriangle size={18} />
        <span>
          <strong>{labels.restrictedTitle}</strong> {labels.restrictedBody}
        </span>
      </div>
    );
  return (
    <SmartDataTable
      tableId="usage.budgets"
      rows={window(budgets)}
      columns={budgetColumns}
      total={budgets.length}
      empty={labels.emptyBudgets}
      {...common}
    />
  );
}
