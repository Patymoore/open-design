# Infographic Patterns

Use these patterns when the user asks for a commercial visual explanation, infographic, business visual, social-card-like visual, or Napkin-style scene and the content is not a strict systems diagram.

These patterns are inspired by common infographic template taxonomies, but v1 still outputs a single self-contained HTML file with inline SVG. Do not import an external infographic runtime.

## Pattern selection

| Source text shows | Pattern | Pair with |
| --- | --- | --- |
| Ordered points with momentum | Zigzag list | `type-process-pipeline.md` or `type-timeline.md` |
| Step-by-step progress with rising importance | Stairs | `type-process-pipeline.md` |
| Central concept with branches | Mind map | `type-tree.md` or `type-cycle.md` |
| Four strategic categories | SWOT / 2x2 card matrix | `type-quadrant.md` |
| One idea split into pros/cons or before/after | Binary comparison | `type-quadrant.md` or `type-venn.md` |
| Network with many nodes and edges | Relation flow | `type-architecture.md` |
| Small set of percentages | Donut / pie callout | `type-cycle.md` only when circular form helps |
| Ranked list with icons | Badge list | Use only if it does not become a generic card grid |
| Growth, reach, conversion, amplification | Cone / megaphone funnel | `type-pyramid.md` |
| Operating cadence or reinforcing loop | Flywheel / radial cycle | `type-cycle.md` |

## Commercial layout rules

- One focal structure per canvas. Supporting labels, legends, and annotations must orbit the focal structure rather than forming a second diagram.
- Vary structure across major regions. If every section is "icon + title + paragraph" in a rounded rectangle, redesign.
- Use editorial hierarchy: title, short lead, visual structure, then captions. Do not let captions dominate.
- Use icons as semantic markers, not decoration. If an icon does not reduce reading effort, omit it.
- Shorten labels before shrinking type. Prefer two strong words over a full sentence inside a shape.
- Keep important text outside complex shapes when the shape would make line breaks awkward.
- Preserve the input language for labels and titles.

## Thumbnail QA

Before finalizing, imagine the diagram shown at 360px wide:

- Can the title still be read?
- Can the viewer identify the visual grammar: funnel, cycle, pipeline, tree, quadrant, etc.?
- Is there exactly one place the eye lands first?
- Are any labels too small, rotated, or overlaid on complex geometry?

If not, simplify the structure before adding more styling.

## Anti-patterns

- Generic dashboard/page composition instead of a diagram.
- Equal card grid for content that has flow, hierarchy, or causality.
- Random blobs, stickers, or gradients that do not encode information.
- Repeating the same accent color on every item.
- Treating "infographic" as permission to invent data.
