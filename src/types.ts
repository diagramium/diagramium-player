/**
 * diagramium-player — public types.
 *
 * Two halves:
 *   1. The Diagramium FILE format: what the editor saves (File → Save) and
 *      what the public gallery serves, as the player reads it.
 *   2. The PLAYER contract: init options, runtime overrides, events.
 */

/* ========================================================================
 * DIAGRAMIUM FILE FORMAT (node-edge documents)
 *
 * The subset of the editor's saved format the player reads. Unknown fields
 * are preserved and ignored, so a newer file still plays. The adapter
 * (src/adapter.ts) relies only on the names exported here.
 * ======================================================================== */

/** One shape. `x`/`y` are the shape's CENTRE in document units. */
export interface DiagramiumNode {
  id: string;
  /** Shape type: 'process' | 'decision' | 'start' | 'end' | 'service' | 'database' | … */
  type?: string;
  text?: string;
  x?: number;
  y?: number;
  /** Explicit size; absent = sized from the text, like the editor does. */
  w?: number;
  h?: number;
  /** Fill/accent colour, or null for the theme default. */
  color?: string | null;
  /** Tree-shaped documents (mind map) carry a parent instead of x/y. */
  parent?: string | null;
  /* Per-shape styling the editor saves (all optional; absent = theme default). */
  /** Label size in px (editor default 12.5). */
  fontSize?: number;
  /** An editor font key ('serif' | 'mono' | 'slab' | 'rounded' | …) or a CSS family list. */
  fontFamily?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: string | null;
  /** A colour, or 'glass' | 'gradient' | 'none'. */
  fill?: string | null;
  borderColor?: string | null;
  borderWidth?: number | null;
  /** 'solid' | 'dashed' | 'dotted' | 'none' */
  borderStyle?: string | null;
  cornerRadius?: number | null;
  opacity?: number | null;
  /** Any other authored field is preserved and ignored by the player. */
  [key: string]: unknown;
}

export interface DiagramiumEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** 'solid' | 'dashed' | 'dotted' */
  style?: string;
  /** Optional authored bend point (document units). */
  bend?: { x: number; y: number } | null;
  [key: string]: unknown;
}

/**
 * Step notes. Keys "1".."N" are the spoken note for the Nth step (the Nth
 * node in `order`, else in `nodes`). Keys starting with "__" are reserved
 * (audio stamps, images, "why" cards) and are ignored by the player except
 * `__why<N>`, which surfaces on the step event.
 */
export type DiagramiumNarration = Record<string, unknown>;

/** The node-edge payload shared by ~90% of diagram types. */
export interface DiagramiumNodeEdgePayload {
  title?: string;
  theme?: string;
  nodes: DiagramiumNode[];
  /** Graph documents use `edges`; mind maps use `links` (cross-links). */
  edges?: DiagramiumEdge[];
  links?: DiagramiumEdge[];
  rootId?: string;
  /** Explicit presentation order: bare ids, or the editor's `{ t: 'n' | 'e', id }` entries. */
  order?: (string | { t?: string; id: string })[];
  narration?: DiagramiumNarration;
  [key: string]: unknown;
}

/** What the editor writes with File → Save project (`.json`). */
export interface DiagramiumProjectFile {
  app: 'flow-diagram';
  version: number;
  mode: string;
  state: DiagramiumNodeEdgePayload | Record<string, unknown>;
}

/** A published catalogue row / content artifact (one diagram per file). */
export interface DiagramiumCatalogueFile {
  id?: string;
  mode: string;
  name?: string;
  description?: string;
  /** 'nodeedge' | 'threat' | 'dsl' | 'octext' */
  payload_kind?: string;
  payload: DiagramiumNodeEdgePayload | string | { source: string; narration?: DiagramiumNarration };
  /** Content artifacts keep narration beside the payload. */
  narration?: DiagramiumNarration | { steps: DiagramiumNarration };
  schema?: string;
  app?: string;
}

/** Everything the player accepts, parsed or as JSON text. */
export type DiagramiumDocument =
  | DiagramiumProjectFile
  | DiagramiumCatalogueFile
  | DiagramiumNodeEdgePayload;

/* ---- end of the file format ---- */


/* ========================================================================
 * PLAYER CONTRACT
 * ======================================================================== */

/** Visual tokens. The three built-in presets mirror the editor's themes. */
export interface ThemeTokens {
  background: string;
  nodeBg: string;
  borderColor: string;
  /** CSS length, e.g. "4px". */
  borderRadius: string;
  fontFamily: string;
  textColor: string;
  connectorColor: string;
  /** Colour of the travelling pulse and the active-step glow. */
  pulseColor: string;
  /** Secondary text (edge labels, caption meta). Defaults from textColor. */
  mutedTextColor?: string;
  /** Faint background grid; omit for none. */
  gridColor?: string;
  /** Frosted-glass nodes over a softly lit backdrop. */
  glass?: boolean;
}

export type ThemePreset = 'linear-midnight' | 'bento-card' | 'glassmorphism';

export interface PlayerOptions {
  /** Element (or selector) the player mounts into. */
  container: HTMLElement | string;
  /** A parsed Diagramium document, or its JSON text. For a URL use `DiagramiumPlayer.fromUrl`. */
  source: DiagramiumDocument | string;
  /** A preset name or a full/partial token set (merged over 'linear-midnight'). */
  theme?: ThemePreset | Partial<ThemeTokens>;
  /** Start playing as soon as it mounts. Default false. */
  autoplay?: boolean;
  /** Milliseconds each step holds during play(). Default 2600. */
  stepDuration?: number;
  /** Wrap to step 0 after the last step while playing. Default false. */
  loop?: boolean;
  /** Step to show on mount: -1 = empty stage, 0 = first step, 'all' = finished diagram on its
      last step, 'overview' = finished diagram with no step highlighted (see showAll). Default 0. */
  initialStep?: number | 'all' | 'overview';
  /** Built-in caption bar with the step's note. Default true. */
  showCaption?: boolean;
  /** Read each step's note aloud with the browser's speech engine. Default false.
      Only voices the browser reports as on-device are used; with none, the
      player stays silent rather than hand the text to an online voice. */
  voice?: boolean;
  /** Arrow-key / space navigation when the player has focus. Default true. */
  keyboard?: boolean;
  /** 'auto' follows prefers-reduced-motion. Default 'auto'. */
  reducedMotion?: 'auto' | 'reduce' | 'no-preference';
  /** Padding around the diagram in document units. Default 40. */
  padding?: number;
  /** Accessible name for the diagram. Defaults to the document title. */
  ariaLabel?: string;
  /** Type settings for node labels. See `FontOptions`. */
  font?: FontOptions;
}

/**
 * Programmatic type control. Pass at construction (`font`) or later with
 * `player.setFont(...)`, which re-lays the diagram (shapes grow to fit, as in
 * the editor) and keeps the current step and any node overrides.
 */
export interface FontOptions {
  /** CSS family list or an editor key ('inter', 'serif', 'mono', 'slab', …).
      Replaces the theme's font. A node's own saved `fontFamily` still wins. */
  family?: string;
  /** Label size in px for EVERY node, overriding each node's saved fontSize. null = use the document's sizes. */
  size?: number | null;
  /** Label weight for every node (e.g. 400, 600, 800). null = document's (600, bold 800). */
  weight?: number | null;
  /** Multiplier applied on top of whatever size wins. Default 1. */
  scale?: number;
}

/** Runtime restyle for one node (live data, health states…). */
export interface NodeStyleOverrides {
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** e.g. "6 4" for dashed. */
  strokeDasharray?: string;
  textColor?: string;
  /** true = theme pulse colour; a string = that colour; false = off. */
  glow?: boolean | string;
  opacity?: number;
  /** Small status chip drawn on the node's top-right corner. null removes it. */
  badge?: { text: string; color?: string } | null;
  /** Label size in px for this node (the shape keeps its size). */
  fontSize?: number;
  /** CSS family list or an editor key for this node's label. */
  fontFamily?: string;
  fontWeight?: number | string;
  italic?: boolean;
}

/** Runtime restyle for one connector (live data along a path). */
export interface EdgeStyleOverrides {
  /** Line colour; the arrowhead follows it. */
  stroke?: string;
  /** Line width in document units. */
  width?: number;
  /** true = theme pulse colour; a string = that colour; false = off. */
  glow?: boolean | string;
  /** Dashed (true) or solid (false), whatever the file says. */
  dashed?: boolean;
  opacity?: number;
  /** Keep the travelling pulse running on this connector, not only on the active step's. */
  pulse?: boolean;
}

export interface StepEvent {
  /** 0-based step index; -1 = nothing revealed. */
  index: number;
  total: number;
  nodeId: string | null;
  /** The step's narration note ('' when the document has none). */
  note: string;
  /** Optional "why this matters" card text (`__why<N>`). */
  why: string;
  /** The node's own label. */
  label: string;
}

/** A shape the pointer or keyboard acted on (nodeclick / nodehover). */
export interface NodeEvent {
  /** The shape's id in the file; null on nodehover when the pointer leaves a shape. */
  nodeId: string | null;
  /** The shape's label (first line breaks kept as \n). '' when nodeId is null. */
  label: string;
  /** The shape's type in the file ('service', 'database', 'group', …). */
  type: string;
  /** Where the shape is on screen (client coordinates), for tooltips and menus. null when leaving. */
  rect: DOMRect | null;
  originalEvent: Event;
}

export interface PlayerEventMap {
  ready: { total: number; title: string };
  step: StepEvent;
  play: { index: number };
  pause: { index: number };
  end: { total: number };
  error: { error: Error };
  /** A visible shape was clicked (or activated with Enter / Space when focused).
      Subscribing makes shapes focusable and shows a pointer cursor. */
  nodeclick: NodeEvent;
  /** The pointer entered a visible shape — or left it (nodeId null). */
  nodehover: NodeEvent;
}

export type PlayerEventName = keyof PlayerEventMap;
export type PlayerListener<K extends PlayerEventName> = (payload: PlayerEventMap[K]) => void;

/* ---- the normalised model the engine renders (internal, but exported for
        advanced hosts that want to inspect what was parsed) ---- */

export type ShapeKind =
  | 'rect' | 'process' | 'pill' | 'diamond' | 'ellipse' | 'circle' | 'cylinder' | 'hexagon' | 'parallelogram'
  | 'iconBox' | 'cloud' | 'group' | 'actor' | 'predefined' | 'document' | 'manualInput' | 'manualOperation'
  | 'offPage' | 'delay' | 'display' | 'note';

/** Resolved per-node look (from the document; null = theme default). */
export interface NodeStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  textColor: string | null;
  fill: string | null;
  borderColor: string | null;
  borderWidth: number | null;
  borderStyle: string | null;
  cornerRadius: number | null;
  opacity: number | null;
  align: string | null;
}

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  shape: ShapeKind;
  color: string | null;
  /** Emoji glyph for icon-box types (service, cache, queue…), as the editor draws it. */
  icon: string | null;
  style: NodeStyle;
  /** Centre + size in document units. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  lines: string[];
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  bend: { x: number; y: number } | null;
  /** Arrowhead at the target end. False where the editor draws plain lines (network cables, mind-map branches…). */
  arrow: boolean;
}

export interface NormalizedDiagram {
  title: string;
  mode: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** One entry per step: the node it reveals and its note. */
  steps: { nodeId: string; note: string; why: string }[];
  bounds: { x: number; y: number; w: number; h: number };
}
