// Headless tests for the file-reading half (parseDiagram). The player itself
// needs a browser — try it with `npm run dev`.
//   npm test          (builds first, then runs node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiagram, DiagramiumFormatError, THEME_PRESETS } from '../dist/index.js';

const FONT = 'Inter, sans-serif';
const example = (f) => JSON.parse(readFileSync(new URL('../examples/' + f, import.meta.url), 'utf8'));

test('every bundled example parses into nodes, edges and one step per node', () => {
  for (const f of ['api-request-handling.json', 'microservices-architecture.json', 'arch-url-shortener.json']) {
    const d = parseDiagram(example(f), FONT);
    assert.ok(d.nodes.length > 0, f);
    assert.equal(d.steps.length, d.nodes.length, f);
    assert.ok(d.bounds.w > 0 && d.bounds.h > 0, f);
    for (const n of d.nodes) assert.ok(n.w > 0 && n.h > 0, f + ' ' + n.id);
  }
});

test('the three document shapes are all accepted', () => {
  const payload = { title: 'T', nodes: [{ id: 'a', type: 'process', text: 'A', x: 0, y: 0 }], edges: [] };
  assert.equal(parseDiagram(payload, FONT).title, 'T');                                          // bare payload
  assert.equal(parseDiagram({ app: 'flow-diagram', version: 1, mode: 'flowchart', state: payload }, FONT).mode, 'flowchart');
  assert.equal(parseDiagram({ mode: 'architecture', name: 'Row', payload }, FONT).title, 'Row');  // catalogue row
  assert.equal(parseDiagram(JSON.stringify(payload), FONT).nodes.length, 1);                      // JSON text
});

test('text-script documents and junk are refused with DiagramiumFormatError', () => {
  const bad = [
    'not json',
    { app: 'flow-diagram', version: 1, mode: 'sequence', state: { actors: [], items: [] } },
    { mode: 'sequence', payload_kind: 'dsl', payload: 'A -> B: hi' },
    { nodes: [] },
    [],
  ];
  for (const b of bad) assert.throws(() => parseDiagram(b, FONT), DiagramiumFormatError, JSON.stringify(b));
});

test('step order follows `order`, including the editor\'s {t, id} entries', () => {
  const nodes = ['a', 'b', 'c'].map((id, i) => ({ id, text: id, x: i * 200, y: 0 }));
  const d = parseDiagram({ nodes, edges: [], order: [{ t: 'n', id: 'c' }, { t: 'e', id: 'x' }, 'a'] }, FONT);
  assert.deepEqual(d.steps.map((s) => s.nodeId), ['c', 'a', 'b']);
});

test('narration key N is the Nth step\'s note; __why<N> rides along', () => {
  const d = parseDiagram({
    nodes: [{ id: 'a', text: 'A', x: 0, y: 0 }, { id: 'b', text: 'B', x: 200, y: 0 }],
    narration: { 1: 'first', 2: { text: 'second' }, __why2: 'because' },
  }, FONT);
  assert.deepEqual(d.steps.map((s) => [s.note, s.why]), [['first', ''], ['second', 'because']]);
});

test('icon-box types carry their glyph; shapes follow the editor', () => {
  const d = parseDiagram({ nodes: [
    { id: 's', type: 'service', text: 'API', x: 0, y: 0 },
    { id: 'd', type: 'database', text: 'DB', x: 300, y: 0 },
    { id: 'q', type: 'decision', text: 'OK?', x: 600, y: 0 },
  ] }, FONT);
  const by = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  assert.equal(by.s.shape, 'iconBox');
  assert.ok(by.s.icon);
  assert.equal(by.d.shape, 'cylinder');
  assert.equal(by.q.shape, 'diamond');
});

test('font options: size overrides every node, scale multiplies, a saved size survives otherwise', () => {
  const doc = { nodes: [{ id: 'a', text: 'A fairly long label', fontSize: 20, x: 0, y: 0 }] };
  assert.equal(parseDiagram(doc, FONT).nodes[0].style.fontSize, 20);
  assert.equal(parseDiagram(doc, { family: FONT, size: 11 }).nodes[0].style.fontSize, 11);
  assert.equal(parseDiagram(doc, { family: FONT, scale: 1.5 }).nodes[0].style.fontSize, 30);
  const w1 = parseDiagram(doc, { family: FONT, size: 11 }).nodes[0].w;
  const w2 = parseDiagram(doc, { family: FONT, size: 30 }).nodes[0].w;
  assert.ok(w2 > w1, 'larger type grows the shape');
});

test('theme presets are present and complete', () => {
  assert.deepEqual(Object.keys(THEME_PRESETS).sort(), ['bento-card', 'glassmorphism', 'linear-midnight']);
  for (const t of Object.values(THEME_PRESETS)) {
    for (const k of ['background', 'nodeBg', 'borderColor', 'fontFamily', 'textColor', 'connectorColor', 'pulseColor']) assert.ok(t[k], k);
  }
});
