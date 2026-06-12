---
name: example-diagram
description: Use this plugin when the user wants to turn existing text, notes, product explanations, systems, workflows, comparisons, decisions, timelines, or structures into commercial/editorial diagrams as self-contained HTML with inline SVG.
license: MIT
metadata:
  version: "0.1.0"
---

# Diagram

Create Napkin-like commercial diagrams from text. The output is a single self-contained `.html` file with embedded CSS and inline SVG. Do not use Mermaid, draw.io, Excalidraw, AntV, image generation, or runtime JavaScript for v1 unless the user explicitly asks for a separate export.

This skill adapts the MIT-licensed `diagram-design` approach by Cathryn Lavery to Open Design's project, design-system, and artifact flow. Use the active project design system and the user's brief as the source of visual direction; do not mutate this plugin's `references/style-guide.md`.

## Workflow

1. Read the Project metadata and Plugin inputs. `sourceText` is the source material; if it only says "the user's brief", use the user's submitted prompt.
2. Choose a diagram type. If `diagramType` is `auto`, infer the visual grammar from the content before asking.
3. Ask at most one narrow question only when the same source text genuinely fits multiple incompatible grammars and the wrong choice would change the artifact.
4. Load the matching `references/type-*.md` file before drawing. For information-graphic layouts that are not a strict systems diagram, also load `references/infographic-patterns.md`. For optional editorial callouts, also load `references/primitive-annotation.md`; for an intentionally hand-drawn variant, load `references/primitive-sketchy.md`.
5. Start from the closest template in `assets/`: `template.html`, `template-dark.html`, or `template-full.html`.
6. Write one HTML file into the project artifact workspace. Use inline SVG for the diagram and embedded CSS for all styling.
7. Run the quality gate below before finalizing.

## Diagram Selection

| Source text shows | Use | Reference |
| --- | --- | --- |
| Components and connections in a system | Architecture | `references/type-architecture.md` |
| Decision logic or branching process | Flowchart | `references/type-flowchart.md` |
| Time-ordered messages between actors | Sequence | `references/type-sequence.md` |
| States and guarded transitions | State machine | `references/type-state.md` |
| Entities, fields, and relationships | ER / data model | `references/type-er.md` |
| Events positioned in time | Timeline | `references/type-timeline.md` |
| Cross-functional handoffs | Swimlane | `references/type-swimlane.md` |
| Two-axis positioning or prioritization | Quadrant | `references/type-quadrant.md` |
| Hierarchy through containment | Nested | `references/type-nested.md` |
| Parent-to-child hierarchy | Tree | `references/type-tree.md` |
| Ownership, routing, escalation, teams | Org chart | `references/type-org-chart.md` |
| Stacked abstraction levels | Layer stack | `references/type-layers.md` |
| Overlap between sets | Venn | `references/type-venn.md` |
| Ranked hierarchy, funnel, drop-off | Pyramid / funnel | `references/type-pyramid.md` |
| Object changes through ordered treatment stages | Process pipeline | `references/type-process-pipeline.md` |
| Continuous loop, flywheel, radial matrix, or four-part cycle | Cycle / radial | `references/type-cycle.md` |
| Editorial list, stairs, zigzag, mind map, SWOT, or compact infographic | Infographic pattern | `references/infographic-patterns.md` plus the closest `type-*.md` |

If a table or paragraph communicates the same thing more clearly, produce the clearer artifact and explain briefly why a diagram would add noise.

## Visual Argument Rules

- Diagrams should argue, not display. The structure should teach a relationship, transformation, trade-off, or causality that prose alone cannot.
- Shape should be the meaning. Use geometry that mirrors the concept: fan-out for many outputs, convergence for merging inputs, cycle for feedback loops, membrane/filter shapes for treatment stages, stairs for progression, and nested rings for containment.
- Run the isomorphism test: if all labels were removed, the reader should still understand the broad structure from shape, position, and flow.
- Run the container test: for every box, ask whether typography alone would work. If yes, remove the box. Reserve containers for real components, phases, groups, decision nodes, or arrow endpoints.
- Avoid the card-grid fallback. A diagram made of equal rounded cards is usually a web layout, not a visual explanation. Use cards only when repeated items are the point.
- Preserve the user's language. If the brief is Chinese, labels stay Chinese; if it is English, labels stay English unless translation is requested.

## Visual Direction

- Prefer the active design system's palette and type direction. If none is available, use restrained editorial defaults from `references/style-guide.md`.
- Use one accent color on at most two focal elements.
- Target density is 4/10. Above 9 nodes, split into overview and detail.
- Human-readable labels use sans-serif; technical sublabels use mono; titles and editorial callouts may use serif.
- Use shapes, position, and hierarchy before color. Do not make every node a rounded rectangle.
- Keep the page previewable inside Open Design: stable viewport, no external images, no build step.

## Output Contract

Always create one self-contained HTML artifact:

- Embedded CSS in the document.
- Inline SVG, with arrows drawn before boxes.
- No external images.
- No JavaScript required for v1.
- Google Fonts are acceptable; include system fallbacks.
- File title should name the diagram, not "Untitled".

When the output should be downloadable as a diagram artifact, include a short note in the HTML comments that the inline SVG is the export source. Do not add a new Open Design API or custom artifact renderer.

## Quality Gate

Before final answer:

- Right diagram type for the source text.
- Matching `references/type-*.md` was used.
- Every node earns its place; merge or remove anything redundant.
- One clear focal point; secondary content supports it instead of competing.
- At least two major visual roles differ when the diagram has multiple concept types; do not make everything the same rounded rectangle.
- Accent appears on no more than two elements.
- Arrows are behind nodes.
- Arrow labels have opaque masks.
- Legend is a bottom strip when needed, not floating inside the drawing.
- No vertical text labels.
- Thumbnail readability check: at roughly 360px wide, the title and core structure are still legible.
- No large unexplained empty band; whitespace must frame the focal structure, not reveal missing content.
- Font sizes, node dimensions, and SVG coordinates follow the 4px grid where practical.
- The resulting file opens directly in a browser and in Open Design preview.
