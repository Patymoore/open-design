# Pyramid / Funnel

**Best for:** hierarchy of needs, prioritization ranks, value pyramids, conversion funnels, directional funnels, megaphone funnels, content importance stacks.

## Orientations — pick one
- **Pyramid** (point up) — narrow apex = most important / rarest / most valuable. Base is broadest / foundational.
- **Funnel** (point down) — narrow end = conversion (smallest group). Top is widest / audience.
- **Directional funnel / cone** (left→right or right→left) — widening or narrowing cone with stage slices. Use for growth paths, acquisition funnels, expansion funnels, awareness→conversion, or "grow a channel" visuals.
- **Megaphone funnel** (wide mouth → narrow handle, or reverse) — communication, amplification, reach, promotion, or broadcast-to-conversion stories.

Don't mix orientations on one diagram.

## Layout conventions
- 4–6 layers. Each layer is a trapezoid or curved slice built from an SVG `<polygon>` or `<path>`.
- Consistent layer height (56–72px).
- Widths decrease linearly from base to apex (pyramid) or top to bottom (funnel). When showing real funnel data, widths must be honest (proportional to count/percentage).
- For directional funnel / cone:
  - Use a single silhouette with stage slices cut by curved or vertical dividers.
  - Stage labels may sit outside the cone with hairline ticks; icons may sit inside slices.
  - Use a subtle dark or paper panel behind the cone when the silhouette needs contrast.
  - Keep slice count to 3–5; beyond that it becomes a pipeline, not a funnel.
- For megaphone funnel:
  - Mouth is the widest stage; handle or tail is the narrowest outcome.
  - If showing amplification, the cone widens in the direction of movement. If showing qualification or conversion, it narrows.
  - Use output arrows or signal lines only at the terminal side; do not decorate every stage.
- Each layer has:
  - **Name label** centered inside the trapezoid — Geist 12–14px 600.
  - **Sublabel** below or beside the name — Geist Mono 9–10px.
  - **Side annotation** (right or left) — optional. For funnels: drop-off percentage here (`−40%`).
- Fill: subtle graded tints OR all paper-2 with hairline dividers (cleaner). Pick one.
- Stroke: 1px hairline between layers; outer silhouette 1px muted or ink.
- **Coral on ONE layer only**: apex of pyramid, conversion layer of funnel, or critical bottleneck.
- Optional left-margin axis arrow + Geist Mono label (`rarer ↑`, `drop-off ↓`).

## Anti-patterns
- 7+ layers (illegible — compress or split).
- Pyramid for non-hierarchical data (use a tree or bar chart).
- Dishonest widths (fake equal spacing when drops are unequal).
- Coral on the base layer (dilutes the "apex = rare" signal).
- Directional cone with no directional semantics (then use layers or a list).
- Equal rectangular cards labeled as a funnel.

## Examples
- `assets/example-pyramid.html` — minimal light
- `assets/example-pyramid-dark.html` — minimal dark
- `assets/example-pyramid-full.html` — full editorial
