/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocaleProvider } from "../../../i18n/locale-context";
import { SubagentInboxPanel } from "../components/task-console/SubagentInboxPanel";
import {
  __resetSubagentInboxControllerForTests,
} from "../subagent-inbox-controller";

function render(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(LocaleProvider, null, createElement(SubagentInboxPanel)));
  });
  return { container, root };
}

describe("SubagentInboxPanel", () => {
  beforeEach(() => {
    __resetSubagentInboxControllerForTests();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the panel header with collapsed body by default", () => {
    const { container } = render();
    const panel = container.querySelector("[data-testid='subagent-inbox-panel']");
    expect(panel).not.toBeNull();
    // spawn input should not be visible when collapsed
    expect(panel?.querySelector("input[placeholder]")).toBeNull();
  });

  it("expands when the header is clicked", () => {
    const { container } = render();
    const panel = container.querySelector("[data-testid='subagent-inbox-panel']");
    const headerButton = panel?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(headerButton).not.toBeNull();
    act(() => {
      headerButton.click();
    });
    // After click, the spawn input should be visible
    const spawnInput = panel?.querySelector("input[placeholder]");
    expect(spawnInput).not.toBeNull();
  });

  it("shows a spawn input and empty hint when expanded with no subagents", () => {
    const { container } = render();
    const panel = container.querySelector("[data-testid='subagent-inbox-panel']");
    const headerButton = panel?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    act(() => {
      headerButton.click();
    });
    // The spawn input + role select should be visible
    const spawnInput = panel?.querySelector("input[placeholder]") as HTMLInputElement;
    expect(spawnInput).not.toBeNull();
    expect(spawnInput.placeholder.length).toBeGreaterThan(0);
    // Role select should be present
    const roleSelect = panel?.querySelector("select") as HTMLSelectElement;
    expect(roleSelect).not.toBeNull();
  });
});