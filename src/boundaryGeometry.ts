import type { Position, PsBoundary, PsNode, Size } from "./types";

export const DEFAULT_NODE_SIZE: Size = { width: 160, height: 64 };
const REMOVAL_GAP = 16;

export interface Rect {
  position: Position;
  size: Size;
}

export function nodeRect(node: PsNode, position = node.position): Rect {
  return { position, size: node.size ?? DEFAULT_NODE_SIZE };
}

export function boundaryRect(boundary: PsBoundary): Rect {
  return { position: boundary.position, size: boundary.size };
}

function right(rect: Rect): number {
  return rect.position.x + rect.size.width;
}

function bottom(rect: Rect): number {
  return rect.position.y + rect.size.height;
}

export function overlapRatio(inner: Rect, outer: Rect): number {
  const width = Math.max(
    0,
    Math.min(right(inner), right(outer)) -
      Math.max(inner.position.x, outer.position.x),
  );
  const height = Math.max(
    0,
    Math.min(bottom(inner), bottom(outer)) -
      Math.max(inner.position.y, outer.position.y),
  );
  const area = inner.size.width * inner.size.height;
  return area > 0 ? (width * height) / area : 0;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.position.x >= outer.position.x &&
    inner.position.y >= outer.position.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

export function clampRectInside(inner: Rect, outer: Rect): Position {
  return {
    x: Math.min(
      Math.max(inner.position.x, outer.position.x),
      right(outer) - inner.size.width,
    ),
    y: Math.min(
      Math.max(inner.position.y, outer.position.y),
      bottom(outer) - inner.size.height,
    ),
  };
}

export function expandRectToContain(outer: Rect, inner: Rect): Rect {
  const x = Math.min(outer.position.x, inner.position.x);
  const y = Math.min(outer.position.y, inner.position.y);
  return {
    position: { x, y },
    size: {
      width: Math.max(right(outer), right(inner)) - x,
      height: Math.max(bottom(outer), bottom(inner)) - y,
    },
  };
}

export function placeNodeOutsideBoundary(
  node: PsNode,
  boundary: PsBoundary,
  remainingBoundaries: readonly PsBoundary[],
): Position {
  const nodeBox = nodeRect(node);
  const boundaryBox = boundaryRect(boundary);
  const candidates: Position[] = [
    {
      x: boundaryBox.position.x - nodeBox.size.width - REMOVAL_GAP,
      y: Math.min(
        Math.max(nodeBox.position.y, boundaryBox.position.y),
        bottom(boundaryBox) - nodeBox.size.height,
      ),
    },
    {
      x: right(boundaryBox) + REMOVAL_GAP,
      y: Math.min(
        Math.max(nodeBox.position.y, boundaryBox.position.y),
        bottom(boundaryBox) - nodeBox.size.height,
      ),
    },
    {
      x: Math.min(
        Math.max(nodeBox.position.x, boundaryBox.position.x),
        right(boundaryBox) - nodeBox.size.width,
      ),
      y: boundaryBox.position.y - nodeBox.size.height - REMOVAL_GAP,
    },
    {
      x: Math.min(
        Math.max(nodeBox.position.x, boundaryBox.position.x),
        right(boundaryBox) - nodeBox.size.width,
      ),
      y: bottom(boundaryBox) + REMOVAL_GAP,
    },
  ];

  const distance = (candidate: Position) =>
    Math.hypot(
      candidate.x - node.position.x,
      candidate.y - node.position.y,
    );
  const preservesAll = (candidate: Position) =>
    remainingBoundaries.every((remaining) =>
      containsRect(boundaryRect(remaining), nodeRect(node, candidate)),
    );

  return (
    candidates.filter(preservesAll).sort((a, b) => distance(a) - distance(b))[0] ??
    candidates.sort((a, b) => distance(a) - distance(b))[0]
  );
}
