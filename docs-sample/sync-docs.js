/**
 * Scroll-synced diagrams for documentation pages.
 *
 * Mark each section of your page with data-step="0", "1", … (one per diagram
 * step), put an element for the diagram on the page, and call syncDocs().
 * Reading drives the diagram — the section being read is the step on screen —
 * and an optional tour button runs it the other way: the diagram plays and
 * the page scrolls along. Copy this file into your own docs as a starting
 * point.
 *
 *   import { syncDocs } from './sync-docs.js';
 *   syncDocs({ file: './my-diagram.json' });
 */
// In your own docs: import { DiagramiumPlayer } from 'diagramium-player';
import { DiagramiumPlayer } from '../src/index.ts';

export async function syncDocs({
  file,                          // the .json saved from the Diagramium editor
  container = '#diagram',        // where the diagram is drawn
  sections = '[data-step]',      // one element per step, in order
  stage = '.stage',              // the pinned block holding the diagram (its bottom sets the reading line)
  tourButton = '#tour',          // optional "Play the tour" button
  themeSelect = '#theme',        // optional theme <select>
  where = '#where',              // optional "Step n of N" label
  theme = 'bento-card',
  stepDuration = 4000,
} = {}) {
  const $ = (s) => document.querySelector(s);
  const steps = [...document.querySelectorAll(sections)];

  const player = await DiagramiumPlayer.fromUrl(file, {
    container,
    theme,
    showCaption: false,          // the prose IS the caption
    initialStep: 0,
    stepDuration,
  });

  let active = -1;
  let touring = false;

  function mark(i) {
    if (i === active) return;
    active = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    const label = $(where);
    if (label) label.textContent = `Step ${i + 1} of ${steps.length}`;
  }

  // Reading drives the diagram. One step forward animates in; a jump is instant.
  function show(i) {
    mark(i);
    if (i === player.currentStep) return;
    if (i === player.currentStep + 1) player.next();
    else player.goToStep(i);
  }

  // "Being read" = the section crossing the reading line — just below the
  // pinned diagram, where a section lands when you jump to it — or the
  // nearest one to it. Short sections included.
  function sectionBeingRead() {
    const top = $(stage) ? $(stage).getBoundingClientRect().bottom : 0;
    const line = top + Math.min(72, (innerHeight - top) * 0.25);
    let best = 0;
    let bestDist = Infinity;
    steps.forEach((s, k) => {
      const r = s.getBoundingClientRect();
      const d = r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line));
      if (d < bestDist) { bestDist = d; best = k; }
    });
    return best;
  }
  let queued = false;
  addEventListener('scroll', () => {
    if (touring || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; show(sectionBeingRead()); });
  }, { passive: true });

  // The tour runs the other way: the diagram plays, the page follows.
  const button = $(tourButton);
  const idleLabel = button ? button.textContent : '';
  function stopTour() {
    touring = false;
    player.pause();
    if (button) button.textContent = idleLabel;
  }
  player.on('step', (e) => {
    if (!touring || e.index < 0) return;
    mark(e.index);
    steps[e.index].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  player.on('end', stopTour);
  if (button) {
    button.addEventListener('click', () => {
      if (touring) { stopTour(); return; }
      touring = true;
      button.textContent = '❚❚ Pause the tour';
      player.goToStep(-1).play();
    });
  }
  // Scrolling by hand hands control back to the reader.
  ['wheel', 'touchmove', 'keydown'].forEach((t) =>
    addEventListener(t, () => { if (touring) stopTour(); }, { passive: true }));

  // A step's number (.num) jumps to its section; the theme switch is one call.
  steps.forEach((s) => {
    const num = s.querySelector('.num');
    if (num) num.addEventListener('click', () => s.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
  const select = $(themeSelect);
  if (select) {
    select.value = theme;
    select.addEventListener('change', (e) => player.setTheme(e.target.value));
  }

  mark(0);
  return player;
}
