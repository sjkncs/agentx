/**
 * Pure annotation geometry + history logic for the screenshot canvas annotator.
 * Kept free of React/DOM so it is unit-testable.
 */

export interface Point {
  x: number;
  y: number;
}

export type AnnotationTool = "pen" | "highlighter" | "rect" | "arrow" | "select";

export type AnnotationElement =
  | {
      id: string;
      tool: "pen" | "highlighter";
      points: Point[];
      color: string;
      size: number;
    }
  | {
      id: string;
      tool: "rect" | "arrow";
      start: Point;
      end: Point;
      color: string;
      size: number;
    };

export interface AnnotationHistory {
  elements: AnnotationElement[];
  /** Elements removed by undo, available for redo. */
  redo: AnnotationElement[];
}

export function createHistory(): AnnotationHistory {
  return { elements: [], redo: [] };
}

/** Commit a new element; clears the redo stack (standard drawing semantics). */
export function pushElement(h: AnnotationHistory, el: AnnotationElement): AnnotationHistory {
  return { elements: [...h.elements, el], redo: [] };
}

export function undo(h: AnnotationHistory): AnnotationHistory {
  if (h.elements.length === 0) return h;
  const last = h.elements[h.elements.length - 1]!;
  return { elements: h.elements.slice(0, -1), redo: [...h.redo, last] };
}

export function redo(h: AnnotationHistory): AnnotationHistory {
  if (h.redo.length === 0) return h;
  const last = h.redo[h.redo.length - 1]!;
  return { elements: [...h.elements, last], redo: h.redo.slice(0, -1) };
}

export function clearHistory(h: AnnotationHistory): AnnotationHistory {
  return { elements: [], redo: [] };
}

/** Axis-aligned bounding box of an element. */
export function boundingBox(el: AnnotationElement): { x0: number; y0: number; x1: number; y1: number } {
  if ("points" in el) {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    return {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };
  }
  return {
    x0: Math.min(el.start.x, el.end.x),
    y0: Math.min(el.start.y, el.end.y),
    x1: Math.max(el.start.x, el.end.x),
    y1: Math.max(el.start.y, el.end.y),
  };
}

/** Translate an element by (dx, dy), returning a new element. */
export function translate(el: AnnotationElement, dx: number, dy: number): AnnotationElement {
  if ("points" in el) {
    return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return {
    ...el,
    start: { x: el.start.x + dx, y: el.start.y + dy },
    end: { x: el.end.x + dx, y: el.end.y + dy },
  };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** Whether a point hits an element within tolerance (for the select tool). */
export function hitTest(el: AnnotationElement, p: Point, tolerance = 6): boolean {
  if ("points" in el) {
    const pad = tolerance + el.size / 2;
    for (let i = 0; i < el.points.length - 1; i++) {
      if (distToSegment(p, el.points[i]!, el.points[i + 1]!) <= pad) return true;
    }
    return el.points.length === 1 && Math.hypot(p.x - el.points[0]!.x, p.y - el.points[0]!.y) <= pad;
  }
  const bb = boundingBox(el);
  const pad = tolerance + el.size / 2;
  if (el.tool === "rect") {
    const onEdge =
      Math.abs(p.x - bb.x0) <= pad || Math.abs(p.x - bb.x1) <= pad ||
      Math.abs(p.y - bb.y0) <= pad || Math.abs(p.y - bb.y1) <= pad;
    const inside = p.x >= bb.x0 - pad && p.x <= bb.x1 + pad && p.y >= bb.y0 - pad && p.y <= bb.y1 + pad;
    return onEdge || inside;
  }
  // arrow: distance to the line segment
  return distToSegment(p, el.start, el.end) <= pad;
}

/** Topmost element hit by a point (later elements are on top), or null. */
export function pickElement(h: AnnotationHistory, p: Point, tolerance = 6): AnnotationElement | null {
  for (let i = h.elements.length - 1; i >= 0; i--) {
    const el = h.elements[i]!;
    if (hitTest(el, p, tolerance)) return el;
  }
  return null;
}

/** Replace an element by id, returning a new history. */
export function replaceElement(h: AnnotationHistory, el: AnnotationElement): AnnotationHistory {
  return { ...h, elements: h.elements.map((e) => (e.id === el.id ? el : e)) };
}

/** Remove an element by id. */
export function removeElement(h: AnnotationHistory, id: string): AnnotationHistory {
  return { ...h, elements: h.elements.filter((e) => e.id !== id) };
}
