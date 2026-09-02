"use client";

import { useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type View = "chart" | "table";

interface Props {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** First load: no data yet. */
  loading?: boolean;
  /** A refetch is in flight: keep the previous render, dimmed. */
  stale?: boolean;
  hasData?: boolean;
  /** Table twin of the chart — enables the chart/table toggle. */
  table?: React.ReactNode;
  action?: React.ReactNode;
  skeletonClassName?: string;
  className?: string;
  children: React.ReactNode;
}

/** Every chart lives in one of these: same header, same loading/empty/stale behaviour, optional table view. */
export function ChartCard({ title, hint, loading, stale, hasData = true, table, action, skeletonClassName = "h-64", className, children }: Props) {
  const t = useTranslations("common");
  const tc = useTranslations("charts");
  const [view, setView] = useState<View>("chart");
  const toggle = table ? (
    <Segmented<View>
      options={[
        { value: "chart", icon: <ChartColumn size={13} />, title: t("chart") },
        { value: "table", icon: <Table2 size={13} />, title: t("table") },
      ]}
      value={view}
      onChange={setView}
      ariaLabel={`${t("chart")} / ${t("table")}`}
    />
  ) : null;

  return (
    <Card className={cn("flex flex-col", className)} stale={stale}>
      <CardHeader
        title={title}
        hint={hint}
        action={
          action || toggle ? (
            <div className="flex items-center gap-2">
              {action}
              {toggle}
            </div>
          ) : undefined
        }
      />
      {loading ? (
        <CardBody>
          <Skeleton className={skeletonClassName} />
        </CardBody>
      ) : !hasData ? (
        <EmptyState title={tc("noData")} className="py-10" />
      ) : view === "table" && table ? (
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">{table}</div>
      ) : (
        <CardBody>{children}</CardBody>
      )}
    </Card>
  );
}
