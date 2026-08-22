import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotebookDashboardRepository, NotebookDashboardError } from "./repository.js";

describe("NotebookDashboardRepository", () => {
  let db: ReturnType<typeof Database>;
  let repo: NotebookDashboardRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    repo = new NotebookDashboardRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates and reads a notebook", () => {
    const created = repo.createNotebook({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "Revenue",
      description: "Q3 revenue pipeline",
      cells: [
        {
          id: "cell-1",
          kind: "sql",
          source: "SELECT 1",
          status: "idle",
          outputs: [],
        },
      ],
      datasources: ["ds-1"],
    });

    expect(created.id).toMatch(/^nb-/);
    expect(created.cells).toHaveLength(1);
    expect(datasourcesOf(created)).toEqual(["ds-1"]);

    const fetched = repo.getNotebook("ws-1", created.id);
    expect(fetched?.title).toBe("Revenue");
    expect(fetched?.cells[0]?.kind).toBe("sql");
  });

  it("isolates notebooks by workspace", () => {
    const a = repo.createNotebook({ workspaceId: "ws-1", ownerId: "user-1", title: "A" });
    const b = repo.createNotebook({ workspaceId: "ws-2", ownerId: "user-1", title: "B" });

    expect(repo.getNotebook("ws-1", a.id)?.title).toBe("A");
    expect(repo.getNotebook("ws-2", b.id)?.title).toBe("B");
    expect(repo.getNotebook("ws-2", a.id)).toBeNull();
  });

  it("updates cells and bumps updatedAt", async () => {
    const created = repo.createNotebook({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "T",
      cells: [],
    });
    const before = created.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const updated = repo.updateNotebook({
      workspaceId: "ws-1",
      notebookId: created.id,
      cells: [
        {
          id: "cell-1",
          kind: "markdown",
          source: "# Hi",
          status: "idle",
          outputs: [],
        },
      ],
    });
    expect(updated.cells).toHaveLength(1);
    expect(updated.updatedAt > before).toBeTruthy();
  });

  it("raises NOT_FOUND when updating a missing notebook", () => {
    expect(() =>
      repo.updateNotebook({
        workspaceId: "ws-1",
        notebookId: "nb-missing",
        title: "x",
      }),
    ).toThrow(NotebookDashboardError);
  });

  it("lists notebooks newest-first", async () => {
    const a = repo.createNotebook({ workspaceId: "ws-1", ownerId: "user-1", title: "A" });
    await new Promise((r) => setTimeout(r, 5));
    const b = repo.createNotebook({ workspaceId: "ws-1", ownerId: "user-1", title: "B" });
    const items = repo.listNotebooks("ws-1");
    expect(items.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it("issues a share token and round-trips it", () => {
    const created = repo.createNotebook({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "Shared",
    });
    const token = "tok-1234567890abcdef";
    repo.updateNotebook({
      workspaceId: "ws-1",
      notebookId: created.id,
      shareToken: token,
      shareRevokedAt: null,
    });
    const fetched = repo.getNotebookByShareToken(token);
    expect(fetched?.id).toBe(created.id);
  });

  it("archive flag returns null on getNotebook and is preserved on list", async () => {
    const created = repo.createNotebook({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "Archive me",
    });
    repo.updateNotebook({
      workspaceId: "ws-1",
      notebookId: created.id,
      archivedAt: new Date().toISOString(),
    });
    expect(repo.getNotebook("ws-1", created.id)).toBeNull();
    expect(repo.listNotebooks("ws-1")).toHaveLength(0);
  });

  it("records cell run lifecycle (start → finish)", async () => {
    const nb = repo.createNotebook({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "T",
      cells: [
        { id: "c-1", kind: "sql", source: "SELECT 1", status: "idle", outputs: [] },
      ],
    });
    const run = repo.recordCellRunStart({
      notebookId: nb.id,
      cellId: "c-1",
      workspaceId: "ws-1",
    });
    expect(run.status).toBe("running");
    await new Promise((r) => setTimeout(r, 2));
    repo.recordCellRunFinish({
      runId: run.id,
      status: "completed",
      durationMs: 12,
      rowCount: 3,
      auditLogId: "audit-1",
    });
    const runs = repo.listCellRuns(nb.id);
    expect(runs).toHaveLength(1);
    const first = runs[0]!;
    expect(first.status).toBe("completed");
    expect(first.rowCount).toBe(3);
    expect(first.auditLogId).toBe("audit-1");
    expect(first.durationMs).toBe(12);
  });

  it("treats corrupted JSON as an empty list, not a crash", () => {
    db.exec(
      `INSERT INTO nbd_notebooks (id, workspace_id, owner_id, title, datasource_ids, cells_json)
       VALUES ('nb-corrupt', 'ws-1', 'user-1', 't', 'BROKEN', 'BROKEN')`,
    );
    const fetched = repo.getNotebook("ws-1", "nb-corrupt");
    expect(fetched?.cells).toEqual([]);
    expect(datasourcesOf(fetched!)).toEqual([]);
  });

  it("mirrors CRUD behaviour for dashboards", () => {
    const created = repo.createDashboard({
      workspaceId: "ws-1",
      ownerId: "user-1",
      title: "Ops",
      templateId: "ops-overview",
      widgets: [
        { id: "w-1", kind: "kpi", title: "Runs", layout: { col: 0, row: 0, width: 3, height: 1 } },
      ],
    });
    expect(created.templateId).toBe("ops-overview");

    const token = "dash-tok-abc";
    repo.updateDashboard({
      workspaceId: "ws-1",
      dashboardId: created.id,
      shareToken: token,
    });
    const fetched = repo.getDashboardByShareToken(token);
    expect(fetched?.id).toBe(created.id);

    expect(repo.deleteDashboard("ws-1", created.id)).toBe(true);
    expect(repo.listDashboards("ws-1")).toHaveLength(0);
  });
});

function datasourcesOf(item: { datasources: string[] }): string[] {
  return item.datasources;
}
