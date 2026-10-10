"use client";

import { useEffect, useRef } from "react";

// Out here rather than in the effect: a dynamic import() inside a component
// makes the React Compiler give up on it.
const loadTank = () => import("./tank");

/**
 * The layer a project card's fish is drawn on: the outline its border turns
 * into, then the fish's own strokes. Empty and hidden until the fish controller
 * — loaded here, after the page is up — fills it in.
 */
export default function FishLayer({ name }: { name: string }) {
  const layer = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = layer.current;
    if (!svg) return;
    let unmounted = false;
    let leave: (() => void) | undefined;
    loadTank()
      .then((tank) => {
        if (!unmounted) leave = tank.register(svg, name);
      })
      // No controller, no fish: the card simply stays a card.
      .catch(() => {});
    return () => {
      unmounted = true;
      leave?.();
    };
  }, [name]);

  return (
    <svg ref={layer} className="fish-layer" aria-hidden="true" focusable="false">
      <path className="fish-outline" />
      <g className="fish-strokes">
        <path className="fish-hatch" />
        <path className="fish-ink" />
      </g>
    </svg>
  );
}
