/**
 * Native schema adaptation: any Diagramium file in, one NormalizedDiagram out.
 *
 * Accepted as-is (no converter):
 *   • Project file   { app: 'flow-diagram', version, mode, state }
 *   • Catalogue row  { id, mode, name, payload_kind, payload }
 *   • Content artifact  { schema: 'diagramium.artifact/…', payload, narration }
 *   • A bare node-edge payload  { title, nodes, edges, narration }
 *
 * Supported today: every NODE-EDGE document (flowchart, architecture, data
 * flow, state machine, ER, UML, C4, network, BPMN, process map, decision
 * tree, concept map, swimlane, timeline, journey map, mind map …). Text-script
 * documents (sequence 'dsl', org chart / sitemap 'octext') need their own
 * layout engines and are rejected with a clear error rather than drawn wrong.
 */
import type {
  DiagramiumEdge,
  DiagramiumNarration,
  DiagramiumNode,
  DiagramiumNodeEdgePayload,
  LayoutEdge,
  LayoutNode,
  NormalizedDiagram,
  ShapeKind,
} from './types';
import { SHAPE_META } from './shapes.generated';

export class DiagramiumFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramiumFormatError';
  }
}

/* ---------------------------------------------------------------- parse -- */

type AnyRecord = Record<string, unknown>;
const isObj = (v: unknown): v is AnyRecord => !!v && typeof v === 'object' && !Array.isArray(v);

interface Unwrapped {
  mode: string;
  title: string;
  payload: DiagramiumNodeEdgePayload;
  narration: DiagramiumNarration;
}

export function unwrap(input: unknown): Unwrapped {
  let doc: unknown = input;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { throw new DiagramiumFormatError('Source is not valid JSON.'); }
  }
  if (!isObj(doc)) throw new DiagramiumFormatError('Source must be a Diagramium document object.');

  let mode = typeof doc.mode === 'string' ? doc.mode : '';
  let kind = typeof doc.payload_kind === 'string' ? doc.payload_kind : '';
  let payload: unknown;
  let sideNarration: unknown = null;
  let title = typeof doc.name === 'string' ? doc.name : '';

  if (doc.app === 'flow-diagram' && isObj(doc.state)) {
    payload = doc.state;                                   // project file
    // Text-script tools save their own state shapes (sequence: actors/items).
    if (!Array.isArray((doc.state as AnyRecord).nodes) && ('actors' in doc.state || 'items' in doc.state || mode === 'sequence')) {
      throw new DiagramiumFormatError(`"${mode || 'sequence'}" diagrams are text scripts; this version of the player draws node-edge diagrams only.`);
    }
  } else if ('payload' in doc) {
    payload = doc.payload;                                 // catalogue row / artifact
    sideNarration = doc.narration;
  } else if (Array.isArray(doc.nodes)) {
    payload = doc;                                         // bare payload
  } else {
    throw new DiagramiumFormatError('Unrecognised document: expected a Diagramium project, catalogue file or node-edge payload.');
  }

  if (kind === 'dsl' || kind === 'octext' || typeof payload === 'string' || (isObj(payload) && typeof payload.source === 'string')) {
    throw new DiagramiumFormatError(
      `"${mode || 'text'}" documents are text scripts (${kind || 'dsl'}); this version of the player draws node-edge diagrams only.`);
  }
  if (!isObj(payload) || !Array.isArray(payload.nodes)) {
    throw new DiagramiumFormatError('Document has no nodes to draw.');
  }
  const p = payload as DiagramiumNodeEdgePayload;
  if (!title && typeof p.title === 'string') title = p.title;
  if (!mode) mode = 'diagram';

  return { mode, title, payload: p, narration: flattenNarration(p.narration, sideNarration) };
}

/** Artifacts keep notes under `narration.steps` or beside the payload; flatten to "1".."N" + "__…". */
function flattenNarration(inside: unknown, beside: unknown): DiagramiumNarration {
  const out: DiagramiumNarration = {};
  for (const src of [beside, inside]) {
    if (!isObj(src)) continue;
    const steps = isObj(src.steps) ? src.steps : src;
    for (const [k, v] of Object.entries(steps)) if (/^[1-9]\d*$/.test(k)) out[k] = v;
    for (const [k, v] of Object.entries(src)) if (k.startsWith('__')) out[k] = v;
  }
  return out;
}

function noteText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isObj(v)) {                                           // segment objects: { text } / { say }
    for (const key of ['text', 'say', 'note']) if (typeof v[key] === 'string') return v[key] as string;
  }
  return '';
}

/* -------------------------------------------------------------- measure -- */

let ctx2d: CanvasRenderingContext2D | null = null;
export function measureText(text: string, fontFamily: string, size = 12.5, weight = 600): number {
  if (typeof document !== 'undefined') {
    ctx2d = ctx2d || document.createElement('canvas').getContext('2d');
    if (ctx2d) {
      ctx2d.font = `${weight} ${size}px ${fontFamily}`;
      return ctx2d.measureText(text).width;
    }
  }
  return text.length * size * 0.56;                         // headless fallback
}

/* ------------------------------------------------------ fonts & shapes -- */

/** The editor's named font stacks. A node's `fontFamily` holds one of these
    KEYS; anything else is used as a CSS font-family list. */
const FONT_STACKS: Record<string, string> = {
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  rounded: "'Segoe UI Rounded', 'Century Gothic', 'Trebuchet MS', sans-serif",
  condensed: "'Arial Narrow', 'Helvetica Neue Condensed', sans-serif",
  geometric: "'Avenir Next', Avenir, Futura, 'Century Gothic', 'Segoe UI', sans-serif",
  humanist: "Optima, 'Gill Sans', 'Gill Sans MT', 'Trebuchet MS', sans-serif",
  editorial: "'Iowan Old Style', Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  didone: "Didot, 'Bodoni 72', 'Bodoni MT', 'Big Caslon', Georgia, serif",
  slab: "Rockwell, 'Roboto Slab', 'Bookman Old Style', 'Courier New', serif",
  typewriter: "'American Typewriter', 'Courier New', Courier, monospace",
  industrial: "'Helvetica Neue', Helvetica, 'Arial Narrow Bold', Impact, sans-serif",
  handwriting: "'Comic Neue', 'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', cursive",
  handnote: "'Bradley Hand', 'Segoe Print', Noteworthy, 'Comic Neue', 'Chalkboard SE', cursive",
  script: "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive",
  grotesque: "'Bricolage Grotesque', 'Avenir Next', 'Helvetica Neue', Arial, sans-serif",
  inter: "Inter, 'Inter Variable', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  geist: "Geist, 'Geist Variable', Inter, 'SF Pro Text', system-ui, sans-serif",
  sfpro: "'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
};
/** Resolve a family: an editor key, a CSS stack, or null → the fallback. */
export function fontStack(family: unknown, fallback: string): string {
  if (typeof family !== 'string' || !family.trim() || family === 'sans') return fallback;
  if (FONT_STACKS[family]) return FONT_STACKS[family]!;
  return /^[\w\s'",-]{1,200}$/.test(family) ? family : fallback;   // a plain CSS family list
}

/** The player-wide type settings (PlayerOptions.font / setFont). */
export interface ResolvedFont { family: string; size: number | null; weight: number | null; scale: number }

/* Which drawing family a node type belongs to — the same families the editor draws. */
function shapeFor(type: string): ShapeKind {
  const meta = SHAPE_META[type];
  if (meta?.render === 'iconBox') return 'iconBox';
  if (meta?.render === 'cloud' || type === 'cloud') return 'cloud';
  if (meta?.render === 'group' || type === 'group' || type === 'boundary' || type === 'trustBoundary') return 'group';
  switch (type) {
    case 'decision': case 'bpmnGwX': case 'bpmnGwParallel': case 'bpmnGwInclusive': case 'bpmnGwEvent': return 'diamond';
    case 'start': case 'end': case 'outcome': case 'terminator': return 'pill';
    case 'database': case 'datastore': return 'cylinder';
    case 'usecase': case 'ellipse': case 'dfProcess': return 'ellipse';
    case 'connector': case 'chance': case 'or': case 'summingJunction': case 'circle':
    case 'initial': case 'final': case 'bpmnStart': case 'bpmnEnd': case 'bpmnInter': return 'circle';
    case 'preparation': case 'hexagon': return 'hexagon';
    case 'io': case 'data': case 'inputOutput': case 'parallelogram': return 'parallelogram';
    case 'predefined': case 'subprocess': return 'predefined';
    case 'document': return 'document';
    case 'manualInput': return 'manualInput';
    case 'manualOperation': return 'manualOperation';
    case 'offPage': return 'offPage';
    case 'delay': return 'delay';
    case 'display': return 'display';
    case 'note': case 'sticky': case 'noteArea': return 'note';
    case 'actor': return 'actor';
    case 'process': return 'process';
    default: return 'rect';
  }
}

/* A shape's natural size for its label width, using the editor's own constants,
   so a file plays at the proportions it was drawn at. */
function naturalSize(shape: ShapeKind, type: string, tw: number): { w: number; h: number } {
  switch (shape) {
    case 'iconBox': return { w: Math.max(120, tw + 44), h: 66 };
    case 'cloud': return { w: Math.max(150, tw + 60), h: 84 };
    case 'diamond': return { w: Math.max(150, tw + 64), h: 84 };
    case 'pill': return { w: Math.max(112, tw + 44), h: 46 };
    case 'cylinder': return { w: Math.max(120, tw + 40), h: 66 };
    case 'ellipse': return { w: Math.max(132, tw + 54), h: 62 };
    case 'circle': { const d = Math.max(54, tw + 24); return { w: d, h: d }; }
    case 'actor': return { w: Math.max(64, tw + 8), h: 100 };
    case 'group': return type === 'group' ? { w: Math.max(240, tw + 80), h: 170 } : { w: Math.max(280, tw + 90), h: 220 };
    case 'predefined': return { w: Math.max(160, tw + 52), h: 58 };
    case 'document': return { w: Math.max(150, tw + 40), h: 64 };
    case 'hexagon': return { w: Math.max(160, tw + 70), h: 64 };
    case 'manualInput': return { w: Math.max(150, tw + 40), h: 58 };
    case 'manualOperation': return { w: Math.max(150, tw + 56), h: 54 };
    case 'offPage': return { w: Math.max(140, tw + 40), h: 64 };
    case 'note': return { w: Math.max(140, tw + 40), h: 120 };
    default: return { w: Math.max(130, tw + 40), h: 52 };
  }
}

/** Size + typography for one node, honouring the document's own fontSize /
    fontFamily / bold and the player's font settings. Line height = size + 5,
    as in the editor. */
function sizeNode(n: DiagramiumNode, shape: ShapeKind, font: ResolvedFont): {
  w: number; h: number; lines: string[]; fontSize: number; fontFamily: string; fontWeight: number;
} {
  const lines = String(n.text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const docSize = typeof n.fontSize === 'number' && n.fontSize > 0 ? n.fontSize : 12.5;
  const fontSize = (font.size ?? docSize) * font.scale;
  const fontFamily = fontStack(n.fontFamily, font.family);
  const fontWeight = font.weight ?? (n.bold ? 800 : 600);
  const tw = Math.max(...lines.map((l) => measureText(l || ' ', fontFamily, fontSize, fontWeight)), 8);
  let { w, h } = naturalSize(shape, String(n.type || ''), tw);
  if (lines.length > 1 && shape !== 'circle') h += (lines.length - 1) * (fontSize + 5) + (shape === 'iconBox' ? 6 : 0);
  if (lines.length > 1 && shape === 'circle') { const side = Math.max(w, h, lines.length * (fontSize + 5) + 38); w = h = side; }
  return {
    w: typeof n.w === 'number' && n.w > 0 ? n.w : w,
    h: typeof n.h === 'number' && n.h > 0 ? n.h : h,
    lines, fontSize, fontFamily, fontWeight,
  };
}

/* --------------------------------------------------------------- layout -- */

/** Tree documents (mind maps) carry parent links, not coordinates. A tidy
    left-to-right layered tree: depth → x, leaves stacked → y. */
function layoutTree(nodes: LayoutNode[], parentOf: Map<string, string | null>, rootId?: string): void {
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    const p = parentOf.get(n.id);
    if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p)!.push(n.id); }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = rootId && byId.has(rootId) ? [rootId] : nodes.filter((n) => !parentOf.get(n.id)).map((n) => n.id);
  const GAP_X = 70, GAP_Y = 18;
  let cursor = 0;
  const colX: number[] = [];
  const depthOf = new Map<string, number>();
  const walkDepth = (id: string, d: number) => {
    depthOf.set(id, d);
    const n = byId.get(id)!;
    colX[d] = Math.max(colX[d] ?? 0, n.w);
    for (const c of kids.get(id) || []) walkDepth(c, d + 1);
  };
  roots.forEach((r) => walkDepth(r, 0));
  const xAt: number[] = [];
  colX.forEach((w, d) => { xAt[d] = d === 0 ? w / 2 : xAt[d - 1]! + (colX[d - 1]! / 2) + GAP_X + w / 2; });
  const place = (id: string): number => {
    const n = byId.get(id)!;
    const cs = kids.get(id) || [];
    n.cx = xAt[depthOf.get(id) ?? 0] ?? 0;
    if (!cs.length) { n.cy = cursor + n.h / 2; cursor += n.h + GAP_Y; return n.cy; }
    const ys = cs.map(place);
    n.cy = (ys[0]! + ys[ys.length - 1]!) / 2;
    return n.cy;
  };
  roots.forEach((r) => { place(r); cursor += GAP_Y * 2; });
}

/* ------------------------------------------------------------ normalise -- */

/** Diagram types whose editor draws connectors as plain lines (it declares them `directed: false`). */
const UNDIRECTED_MODES = new Set(['network', 'fishbone', 'usecase', 'erdiagram']);

export function normalize(input: unknown, fontOrFamily: string | Partial<ResolvedFont> = {}): NormalizedDiagram {
  const font: ResolvedFont = typeof fontOrFamily === 'string'
    ? { family: fontOrFamily, size: null, weight: null, scale: 1 }
    : { family: fontOrFamily.family || "Inter, system-ui, sans-serif", size: fontOrFamily.size ?? null,
        weight: fontOrFamily.weight ?? null, scale: fontOrFamily.scale && fontOrFamily.scale > 0 ? fontOrFamily.scale : 1 };
  const { mode, title, payload, narration } = unwrap(input);

  const nodes: LayoutNode[] = [];
  const parentOf = new Map<string, string | null>();
  let needsTreeLayout = false;
  for (const raw of payload.nodes) {
    if (!isObj(raw) || typeof raw.id !== 'string') continue;
    const n = raw as DiagramiumNode;
    const type = String(n.type || (n.parent !== undefined ? 'topic' : 'process'));
    const shape: ShapeKind = n.parent !== undefined ? 'pill' : shapeFor(type);
    const sz = sizeNode(n, shape, font);
    const hasXY = typeof n.x === 'number' && typeof n.y === 'number';
    if (!hasXY) needsTreeLayout = true;
    parentOf.set(n.id, typeof n.parent === 'string' ? n.parent : null);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
    nodes.push({
      id: n.id, label: String(n.text ?? ''), type, shape,
      color: str(n.color),
      icon: shape === 'iconBox' ? (SHAPE_META[type]?.icon ?? null) : null,
      cx: hasXY ? (n.x as number) : 0, cy: hasXY ? (n.y as number) : 0, w: sz.w, h: sz.h, lines: sz.lines,
      style: {
        fontSize: sz.fontSize, fontFamily: sz.fontFamily, fontWeight: sz.fontWeight,
        italic: n.italic === true, underline: n.underline === true,
        textColor: str(n.textColor), fill: str(n.fill), borderColor: str(n.borderColor),
        borderWidth: num(n.borderWidth), borderStyle: str(n.borderStyle), cornerRadius: num(n.cornerRadius),
        opacity: num(n.opacity), align: str(n.align),
      },
    });
  }
  if (!nodes.length) throw new DiagramiumFormatError('Document has no drawable nodes.');
  if (needsTreeLayout) layoutTree(nodes, parentOf, payload.rootId);

  const ids = new Set(nodes.map((n) => n.id));
  const arrow = !UNDIRECTED_MODES.has(mode);
  const rawEdges: DiagramiumEdge[] = [...(payload.edges || []), ...(payload.links || [])];
  const edges: LayoutEdge[] = [];
  for (const e of rawEdges) {
    if (!isObj(e) || !ids.has(e.from) || !ids.has(e.to)) continue;
    edges.push({
      id: String(e.id || `${e.from}-${e.to}`), from: e.from, to: e.to,
      label: typeof e.label === 'string' ? e.label : '',
      dashed: e.style === 'dashed' || e.style === 'dotted',
      bend: isObj(e.bend) && typeof e.bend.x === 'number' && typeof e.bend.y === 'number' ? { x: e.bend.x, y: e.bend.y } : null,
      arrow,
    });
  }
  // Tree documents: the hierarchy itself is the connector set.
  for (const [id, parent] of parentOf) {
    if (parent && ids.has(parent)) edges.push({ id: `tree-${parent}-${id}`, from: parent, to: id, label: '', dashed: false, bend: null, arrow: false });
  }

  /* Step order: an explicit `order` (node ids; edge ids are skipped — an edge
     appears with its later endpoint), else authored node order. Narration key
     N is the Nth node in that order — the editor's own contract. */
  /* The editor saves `order` as objects — { t: 'n', id } for a node, { t: 'e', id }
     for an edge — while older files hold bare ids. Accept both. */
  const orderIds = Array.isArray(payload.order)
    ? (payload.order as unknown[]).map((o) => (typeof o === 'string' ? o : isObj(o) && typeof o.id === 'string' && (o.t === undefined || o.t === 'n') ? o.id : null))
        .filter((id): id is string => !!id && ids.has(id))
    : [];
  const seen = new Set(orderIds);
  const order = [...orderIds, ...nodes.map((n) => n.id).filter((id) => !seen.has(id))];
  const steps = order.map((nodeId, i) => ({
    nodeId,
    note: noteText(narration[String(i + 1)]),
    why: noteText(narration[`__why${i + 1}`]),
  }));

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.cx - n.w / 2); y0 = Math.min(y0, n.cy - n.h / 2);
    x1 = Math.max(x1, n.cx + n.w / 2); y1 = Math.max(y1, n.cy + n.h / 2);
  }
  for (const e of edges) if (e.bend) { x0 = Math.min(x0, e.bend.x); y0 = Math.min(y0, e.bend.y); x1 = Math.max(x1, e.bend.x); y1 = Math.max(y1, e.bend.y); }

  return { title, mode, nodes, edges, steps, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/* ---------------------------------------------------------- edge geometry -- */

/** Where a ray from the node centre toward (tx, ty) leaves the node's outline. */
export function boundaryPoint(n: LayoutNode, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - n.cx, dy = ty - n.cy;
  if (!dx && !dy) return { x: n.cx, y: n.cy };
  const hw = n.w / 2, hh = n.h / 2;
  let t: number;
  if (n.shape === 'ellipse' || n.shape === 'circle') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (n.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: n.cx + dx * t, y: n.cy + dy * t };
}

/** SVG path for an edge: straight, or a smooth curve through an authored bend. */
export function edgePath(a: LayoutNode, b: LayoutNode, bend: { x: number; y: number } | null): { d: string; mid: { x: number; y: number } } {
  if (bend) {
    const p = boundaryPoint(a, bend.x, bend.y), q = boundaryPoint(b, bend.x, bend.y);
    // Quadratic control point chosen so the curve passes THROUGH the bend.
    const cx = 2 * bend.x - (p.x + q.x) / 2, cy = 2 * bend.y - (p.y + q.y) / 2;
    return { d: `M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`, mid: { x: bend.x, y: bend.y } };
  }
  const p = boundaryPoint(a, b.cx, b.cy), q = boundaryPoint(b, a.cx, a.cy);
  return { d: `M ${p.x} ${p.y} L ${q.x} ${q.y}`, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
}
