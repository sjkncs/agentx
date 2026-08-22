/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../../../i18n/locale-context";
import { DiffViewer } from "../components/task-console/DiffViewer";

function render(props: { repoPath?: string; base?: string; head?: string }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      createElement(
        LocaleProvider,
        null,
        createElement(DiffViewer, props),
      ),
    );
  });
  return container;
}

describe("DiffViewer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { base: "main", head: "HEAD", files: [], totalAdditions: 0, totalDeletions: 0 } }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders the panel collapsed by default and does not call fetch", () => {
    const container = render({});
    const panel = container.querySelector("[data-testid='diff-viewer']");
    expect(panel).not.toBeNull();
    // When collapsed, the repo path input should NOT be visible
    expect(panel?.querySelector("input[placeholder]")).toBeNull();
    // No fetch yet because the panel is collapsed
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expands on header click and shows the repo input", () => {
    const container = render({});
    const panel = container.querySelector("[data-testid='diff-viewer']");
    const header = panel?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    act(() => {
      header.click();
    });
    // Now the repo input is visible (placeholder ends with "repo" or "路径")
    const repoInput = panel?.querySelector("input[placeholder]");
    expect(repoInput).not.toBeNull();
    const placeholder = (repoInput as HTMLInputElement).placeholder;
    expect(placeholder.length).toBeGreaterThan(0);
  });

  it("calls /api/diff when opened with a repo path", async () => {
    const container = render({ repoPath: "/some/repo" });
    const panel = container.querySelector("[data-testid='diff-viewer']");
    const header = panel?.querySelector("button[aria-expanded]");
    act(() => {
      (header as HTMLButtonElement).click();
    });
    // Wait for fetch promise chain
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/diff?");
    expect(url).toContain("repo=%2Fsome%2Frepo");
  });

  it("does NOT call /api/diff when opened without any repo path", async () => {
    const container = render({});
    const panel = container.querySelector("[data-testid='diff-viewer']");
    const header = panel?.querySelector("button[aria-expanded]");
    act(() => {
      (header as HTMLButtonElement).click();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});