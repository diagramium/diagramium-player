# Changelog

## 0.2.0 — 2026-10-01 — interactive shapes and connectors

- `nodeclick` and `nodehover` events with the shape's id, label, type and screen rect. Listening for clicks makes shapes keyboard-focusable buttons.
- `updateEdgeStyle()` / `resetEdgeStyle()`: colour, width, glow, dashes, opacity and a persistent pulse per connector; the arrowhead takes the connector's colour.
- `getNodeRect()`: a shape's position on screen, for tooltips.
- `showAll()`, `isOverview` and `initialStep: 'overview'`: the finished diagram with no step highlighted, for dashboards.
- A recoloured connector's travelling pulse takes its colour.
- Network, fishbone, use-case and ER diagrams draw plain connectors with no arrowheads, as the editor does (`LayoutEdge.arrow`).
- `parseDiagram(doc)` no longer needs a font argument.

## 0.1.0 — 2026-09-29 — first public release

Published on npm: https://www.npmjs.com/package/diagramium-player

- Plays Diagramium node-edge diagrams (flowchart, architecture, data flow, state machine, ER, UML class, C4, network, BPMN, mind map and more) from the editor's saved files and the gallery's files.
- Step-by-step reveal with animation, captions, `__why` notes and optional on-device narration.
- Chainable API: `play`, `pause`, `next`, `prev`, `goToStep`, `goToNode`, `updateNodeStyle`, `setTheme`, `setFont` and events.
- Editor-matching shapes (icon boxes, cylinders, clouds, groups, flowchart set, actors) and per-node styles.
- Three theme presets: Linear Midnight, Bento Card and Glassmorphism.
