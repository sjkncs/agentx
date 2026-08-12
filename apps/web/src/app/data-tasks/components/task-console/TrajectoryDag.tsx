"use client";

import { useMemo } from "react";
import { useT } from "../../../../i18n/locale-context";
import type { LiveTrajectory, LiveTrajectoryNode } from "../../live-run-state";

/**
 * Renders the LATS tree-search branch DAG as an indented, status-colored tree.
 * - active branch: primary highlight
 * - failed branch: red, with failure reason + Reflexion reflection
 * - open branch: muted
 * Hidden when no trajectory is present (LATS disabled / ReAct mode).
 */
export function TrajectoryDag({ trajectory }: { trajectory: LiveTrajectory | undefined }) {
  const t = useT();

  const roots = useMemo(
    () => (trajectory ? trajectory.nodes.filter((n) => n.parentId === null) : []),
    [trajectory],
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, LiveTrajectoryNode[]>();
    if (!trajectory) return map;
    for (const node of trajectory.nodes) {
      if (node.parentId === null) continue;
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    return map;
  }, [trajectory]);

  if (!trajectory || trajectory.nodes.length === 0) {
    return null;
  }

  const renderNode = (node: LiveTrajectoryNode): React.ReactNode => {
    const children = childrenByParent.get(node.nodeId) ?? [];
    return (
      <div key={node.nodeId} className="grid gap-1" style={{ marginLeft: node.depth === 0 ? 0 : 16 }}>
        <div
          data-testid={`trajectory-node-${node.status}`}
          className={[
            "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
            node.status === "active"
              ? "border-primary/40 bg-primary-light/10"
              : node.status === "failed"
                ? "border-rose-300/60 bg-rose-50"
                : "border-border bg-surface-subtle",
          ].join(" ")}
        >
          <span
            className={[
              "mt-0.5 h-2 w-2 shrink-0 rounded-full",
              node.status === "active"
                ? "bg-primary"
                : node.status === "failed"
                  ? "bg-rose-500"
                  : "bg-muted-light",
            ].join(" ")}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {node.actions.length > 0 ? node.actions.join(" → ") : t("trajectory.root")}
              </span>
              {node.score !== null ? (
                <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[10px] tabular text-muted">
                  {node.score.toFixed(2)}
                </span>
              ) : null}
            </div>
            {node.status === "failed" && node.failureReason ? (
              <p className="mt-0.5 truncate text-[11px] text-rose-600" title={node.failureReason}>
                {node.failureReason}
              </p>
            ) : null}
            {node.reflection ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] italic text-muted" title={node.reflection}>
                {t("trajectory.reflection")}: {node.reflection}
              </p>
            ) : null}
          </div>
        </div>
        {children.map((child) => renderNode(child))}
      </div>
    );
  };

  return (
    <div data-testid="trajectory-dag" className="grid gap-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-light">
        {t("trajectory.title")}
      </div>
      {roots.map((root) => renderNode(root))}
    </div>
  );
}
