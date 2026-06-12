# Cycle / Radial

**Best for:** continuous improvement loops, flywheels, feedback cycles, four-part strategy maps, circular matrices, security/scalability trade-off loops, and recurring operating cadences.

Use this when the central message is "these parts reinforce each other" or "the reader should compare positions around a center." Do not use it for a one-way sequence with a true start and end; use `type-process-pipeline.md` or `type-flowchart.md` instead.

## Layout conventions

- 3–6 segments arranged around a central negative space. Four segments is the default for strategy matrices.
- Segment shapes:
  - **Ring arrows** for reinforcing cycles or flywheels.
  - **Pinwheel wedges** for directional rotation or strategy quadrants.
  - **Radial nodes** around a center for hub-and-spoke ideas.
  - **Figure-eight / infinity** only when two loops exchange value.
- Keep the center mostly empty or use it for a short title (1–3 words). Do not put a paragraph in the center.
- Labels sit outside the ring when they are sentence-length; short labels can sit inside segments.
- Use one color per segment only when each segment is a category. If the message has one focal segment, use one accent and keep other segments neutral.
- Add faint axis labels only when the diagram is also a matrix, for example `High scalability`, `Low security`.
- Direction arrowheads should be integrated into the segment shape. Avoid adding separate arrow icons over the ring unless the direction is otherwise unclear.

## Text rules

- Segment label: 12–16px, 600 weight.
- Outside explanation: 14–20px depending on canvas size, max two lines.
- Axis labels: 11–13px, muted, far enough from the ring to avoid collision.

## Anti-patterns

- A cycle used for a linear process with a clear final state.
- Too many labels inside the ring.
- Equal-color rainbow when there is no categorical meaning.
- Center text that competes with the segments.
- Loose arrows floating near a circle instead of being part of the cycle geometry.

## SVG notes

- Build ring segments with `<path>` arcs or thick stroked arcs. Keep path endpoints clean so arrowheads read at thumbnail size.
- For a simpler v1 implementation, approximate ring arrows with 4 curved `<path>` segments plus small triangular arrowheads.
- Draw any axis labels and outside explanations after the ring so they stay readable.
