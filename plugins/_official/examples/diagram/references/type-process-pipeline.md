# Process Pipeline / Transformation

**Best for:** treatment processes, manufacturing steps, water purification, data transformation, content production, model training pipelines, and any ordered stages where an object changes as it passes through each stage.

Use this instead of Flowchart when the primary story is transformation rather than branching. A process pipeline has stages, inputs, outputs, and visible changes. A flowchart has decisions.

## Layout conventions

- Flow runs left→right for physical/product pipelines, top→down for procedures. Pick one and hold it.
- Stages are visually distinct treatment zones, not identical cards:
  - **Membrane/filter discs** for purification or screening.
  - **Station blocks** for manufacturing or assembly.
  - **Tunnels/bands** for data or content transformation.
  - **Before/after clusters** for visible particles, records, users, or signals changing over time.
- Show the object being transformed. Examples:
  - Dots/particles reduce across filters.
  - Raw records become normalized records, then metrics.
  - Rough input becomes polished output.
- Arrows indicate direction only; the transformation should be visible without reading the arrow labels.
- Use 3–6 stages. If there are more, group into phases or split into overview/detail.
- Stage labels sit below or above the stage. Explanatory sublabels are short and should not become paragraphs.
- Use sketchy style when the prompt asks for whiteboard, hand-drawn, classroom, or concept explanation; load `primitive-sketchy.md`.

## Text rules

- Title: large, direct, and centered or left-aligned depending on canvas.
- Stage name: 14–20px, 600–700 weight.
- Stage explanation: 10–14px, max two lines.
- Avoid vertical labels.

## Anti-patterns

- Decision diamonds in a transformation pipeline.
- Equal rounded cards with icons only; that reads as a webpage feature list.
- No visible change between stages.
- Over-explaining every stage with long copy.
- Decorative particles that do not encode the process.

## SVG notes

- Draw arrows and particles before stage containers when particles should appear behind filters.
- For filter/membrane visuals, use ellipses with 2–3 offset strokes to create depth.
- Use fewer particles after each stage to show removal, purification, compression, or refinement.
- Keep particles on a grid or loose rhythm so the image reads intentionally rather than noisy.
