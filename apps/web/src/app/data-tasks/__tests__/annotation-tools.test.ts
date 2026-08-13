import { describe, expect, it } from "vitest";

import {
  boundingBox,
  createHistory,
  hitTest,
  pickElement,
  pushElement,
  redo,
  removeElement,
  translate,
  undo,
  type AnnotationElement,
} from "../components/annotation/annotation-tools";

const pen = (id: string, pts: Array<[number, number]>): AnnotationElement => ({
  id,
  tool: "pen",
  points: pts.map(([x, y]) => ({ x, y })),
  color: "#f00",
  size: 2,
});

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): AnnotationElement => ({
  id,
  tool: "rect",
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
  color: "#00f",
  size: 2,
});

describe("annotation history", () => {
  it("push clears redo; undo/redo round-trip", () => {
    let h = createHistory();
    h = pushElement(h, pen("a", [[0, 0], [5, 5]]));
    h = pushElement(h, rect("b", 0, 0, 10, 10));
    expect(h.elements.map((e) => e.id)).toEqual(["a", "b"]);

    h = undo(h);
    expect(h.elements.map((e) => e.id)).toEqual(["a"]);
    expect(h.redo.map((e) => e.id)).toEqual(["b"]);

    // pushing after undo clears redo
    h = pushElement(h, pen("c", [[1, 1]]));
    expect(h.redo).toHaveLength(0);

    h = undo(h);
    h = redo(h);
    expect(h.elements.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("undo/redo on empty history are no-ops", () => {
    const h = createHistory();
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});

describe("annotation geometry", () => {
  it("boundingBox for pen and rect", () => {
    expect(boundingBox(pen("a", [[1, 2], [5, 3], [3, 9]]))).toEqual({ x0: 1, y0: 2, x1: 5, y1: 9 });
    expect(boundingBox(rect("b", 10, 20, 5, 30))).toEqual({ x0: 5, y0: 20, x1: 10, y1: 30 });
  });

  it("translate shifts pen points and shape endpoints", () => {
    const movedPen = translate(pen("a", [[0, 0], [2, 2]]), 10, -5);
    if (!("points" in movedPen)) throw new Error("expected pen");
    expect(movedPen.points).toEqual([
      { x: 10, y: -5 },
      { x: 12, y: -3 },
    ]);
    const movedRect = translate(rect("b", 0, 0, 4, 4), 1, 1);
    if ("points" in movedRect) throw new Error("expected rect");
    expect(movedRect.start).toEqual({ x: 1, y: 1 });
  });

  it("hitTest detects pen stroke, rect edge, and arrow line", () => {
    expect(hitTest(pen("a", [[0, 0], [10, 0]]), { x: 5, y: 1 })).toBe(true);
    expect(hitTest(pen("a", [[0, 0], [10, 0]]), { x: 5, y: 20 })).toBe(false);

    expect(hitTest(rect("b", 0, 0, 10, 10), { x: 0, y: 5 })).toBe(true); // on edge
    expect(hitTest(rect("b", 0, 0, 10, 10), { x: 5, y: 5 })).toBe(true); // inside

    const arrow: AnnotationElement = { id: "c", tool: "arrow", start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, color: "#0f0", size: 2 };
    expect(hitTest(arrow, { x: 5, y: 5 }, 2)).toBe(true);
    expect(hitTest(arrow, { x: 5, y: 0 }, 2)).toBe(false);
  });

  it("pickElement returns topmost hit and removeElement drops by id", () => {
    let h = createHistory();
    h = pushElement(h, pen("a", [[0, 0], [10, 0]]));
    h = pushElement(h, pen("b", [[0, 1], [10, 1]])); // on top, near same line
    const picked = pickElement(h, { x: 5, y: 1 });
    expect(picked?.id).toBe("b");

    const after = removeElement(h, "b");
    expect(after.elements.map((e) => e.id)).toEqual(["a"]);
  });
});
