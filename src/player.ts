/**
 * DiagramiumPlayer — the runtime engine.
 *
 * Design notes
 *  • Pure DOM + SVG + CSS keyframes + Web Animations API. No canvas engine,
 *    no dependencies.
 *  • Mounted in a SHADOW ROOT: the host page's CSS cannot restyle the diagram
 *    and the player's CSS cannot leak into the host.
 *  • The diagram is drawn ONCE. A step change only flips classes and runs a
 *    few short WAAPI animations — no re-render, so seeking is O(nodes).
 *  • Untrusted input: every string from the document reaches the DOM through
 *    textContent / setAttribute, never innerHTML; colours pass safeColor().
 *  • Chainable: every control method returns `this`.
 */
import { DiagramiumFormatError, edgePath, fontStack, measureText, normalize } from './adapter';
import type { ResolvedFont } from './adapter';
import { resolveTheme, safeColor } from './themes';
import type {
  FontOptions,
  LayoutNode,
  NodeStyleOverrides,
  NormalizedDiagram,
  PlayerEventMap,
  PlayerEventName,
  PlayerListener,
  PlayerOptions,
  StepEvent,
  ThemePreset,
  ThemeTokens,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

interface NodeView { g: SVGGElement; body: SVGGElement; shape: SVGGraphicsElement; text: SVGTextElement; icon: SVGTextElement | null; badge: SVGGElement | null; node: LayoutNode }
interface EdgeView { g: SVGGElement; line: SVGPathElement; pulse: SVGPathElement; from: string; to: string; dashed: boolean }

let instanceCounter = 0;

export class DiagramiumPlayer {
  /** Fetch a document over HTTP and mount it. Credentials are omitted by default. */
  static async fromUrl(url: string, options: Omit<PlayerOptions, 'source'>, init: RequestInit = {}): Promise<DiagramiumPlayer> {
    const res = await fetch(url, { credentials: 'omit', ...init });
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    return new DiagramiumPlayer({ ...options, source: await res.json() });
  }

  /** The parsed, laid-out diagram (read-only view for hosts; replaced by setFont). */
  get diagram(): NormalizedDiagram { return this._diagram; }
  private _diagram: NormalizedDiagram;
  private readonly source: PlayerOptions['source'];
  private fontOpts: FontOptions;

  private readonly opts: Required<Omit<PlayerOptions, 'container' | 'source' | 'theme' | 'ariaLabel' | 'font'>> & { ariaLabel: string };
  private theme: ThemeTokens;
  private readonly uid = `dgm${++instanceCounter}`;
  private readonly shadow: ShadowRoot;
  private readonly rootEl: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private svg: SVGSVGElement;
  private readonly captionCount: HTMLSpanElement;
  private readonly captionNote: HTMLParagraphElement;
  private readonly captionWhy: HTMLParagraphElement;
  private readonly nodes = new Map<string, NodeView>();
  private readonly edges = new Map<string, EdgeView>();
  private readonly stepOfNode = new Map<string, number>();
  private readonly overrides = new Map<string, NodeStyleOverrides>();
  private readonly listeners = new Map<PlayerEventName, Set<PlayerListener<PlayerEventName>>>();
  private readonly running = new Set<Animation>();
  private index = -1;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Set once `ready` has fired; `ready` and `step` are then replayed to late subscribers. */
  private isReady = false;
  private readonly reduceQuery: MediaQueryList | null;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(options: PlayerOptions) {
    const host = typeof options.container === 'string'
      ? document.querySelector<HTMLElement>(options.container)
      : options.container;
    if (!host) throw new Error(`Diagramium: container ${String(options.container)} was not found.`);

    this.theme = resolveTheme(options.theme);
    this.source = options.source;
    this.fontOpts = cleanFont(options.font);
    this._diagram = normalize(options.source, this.resolvedFont());   // throws DiagramiumFormatError
    this.opts = {
      autoplay: options.autoplay ?? false,
      stepDuration: Math.max(400, options.stepDuration ?? 2600),
      loop: options.loop ?? false,
      initialStep: options.initialStep ?? 0,
      showCaption: options.showCaption ?? true,
      voice: options.voice ?? false,
      keyboard: options.keyboard ?? true,
      reducedMotion: options.reducedMotion ?? 'auto',
      padding: options.padding ?? 40,
      ariaLabel: options.ariaLabel ?? (this.diagram.title || 'Animated diagram'),
    };
    this.diagram.steps.forEach((s, i) => this.stepOfNode.set(s.nodeId, i));
    this.reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

    // delegatesFocus: focusing/clicking the host element focuses the player, so keyboard control just works.
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open', delegatesFocus: true });
    this.shadow.replaceChildren();
    const style = document.createElement('style');
    style.textContent = PLAYER_CSS;
    this.styleEl = style;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'dgm-root';
    this.rootEl.setAttribute('role', 'group');
    this.rootEl.setAttribute('aria-roledescription', 'animated diagram');
    this.rootEl.setAttribute('aria-label', this.opts.ariaLabel);
    if (this.opts.keyboard) { this.rootEl.tabIndex = 0; this.rootEl.addEventListener('keydown', this.onKey); }

    this.svg = this.buildSvg();
    const caption = document.createElement('div');
    caption.className = 'dgm-caption';
    caption.hidden = !this.opts.showCaption;
    caption.setAttribute('aria-live', 'polite');
    this.captionCount = document.createElement('span');
    this.captionCount.className = 'dgm-count';
    this.captionNote = document.createElement('p');
    this.captionNote.className = 'dgm-note';
    this.captionWhy = document.createElement('p');
    this.captionWhy.className = 'dgm-why';
    caption.append(this.captionCount, this.captionNote, this.captionWhy);

    this.rootEl.append(this.svg, caption);
    this.shadow.append(style, this.rootEl);
    this.applyTheme();

    const start = this.opts.initialStep === 'all' ? this.total - 1 : this.opts.initialStep;
    this.applyStep(Math.max(-1, Math.min(start, this.total - 1)), false);

    // Deferred so listeners attached by chaining (`new Player(o).on('ready', …)`) still fire.
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.isReady = true;
      this.emit('ready', { total: this.total, title: this.diagram.title });
      this.emit('step', this.stepEvent());
      if (this.opts.autoplay) this.play();
    });
  }

  /* ================================================================ API === */

  get total(): number { return this.diagram.steps.length; }
  get currentStep(): number { return this.index; }
  get isPlaying(): boolean { return this.playing; }

  /** Start the chronological sequence (restarts from the top if finished). */
  play(): this {
    if (this.destroyed || this.playing || !this.total) return this;
    if (this.index >= this.total - 1) this.applyStep(-1, false);
    this.playing = true;
    this.rootEl.classList.add('is-playing');
    this.emit('play', { index: this.index });
    this.scheduleTick(this.index < 0 ? 0 : this.opts.stepDuration);
    return this;
  }

  pause(): this {
    if (!this.playing) return this;
    this.playing = false;
    this.rootEl.classList.remove('is-playing');
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.stopVoice();
    this.emit('pause', { index: this.index });
    return this;
  }

  toggle(): this { return this.playing ? this.pause() : this.play(); }

  /** Advance exactly one step, with the entrance animation. */
  next(): this {
    if (this.index < this.total - 1) this.goTo(this.index + 1, true);
    return this;
  }

  /** Go back exactly one step (instant — un-drawing is not a story beat). */
  prev(): this {
    if (this.index > -1) this.goTo(this.index - 1, false);
    return this;
  }

  /** Seek instantly to a step (0-based). -1 empties the stage; out-of-range values clamp. */
  goToStep(index: number): this {
    if (!Number.isFinite(index)) throw new RangeError('goToStep(index) needs a number.');
    this.goTo(Math.max(-1, Math.min(Math.trunc(index), this.total - 1)), false);
    return this;
  }

  /** Seek to the step that reveals a given node. */
  goToNode(nodeId: string): this {
    const i = this.stepOfNode.get(nodeId);
    if (i == null) throw new RangeError(`Unknown node "${nodeId}".`);
    return this.goToStep(i);
  }

  /** Restyle one node at runtime (live data). Overrides persist across seeks. */
  updateNodeStyle(nodeId: string, overrides: NodeStyleOverrides): this {
    const view = this.nodes.get(nodeId);
    if (!view) throw new RangeError(`Unknown node "${nodeId}".`);
    const merged = { ...this.overrides.get(nodeId), ...overrides };
    this.overrides.set(nodeId, merged);
    this.paintOverrides(view, merged);
    return this;
  }

  /** Drop every runtime override on a node (or all nodes). */
  resetNodeStyle(nodeId?: string): this {
    const ids = nodeId ? [nodeId] : [...this.overrides.keys()];
    for (const id of ids) {
      const view = this.nodes.get(id);
      if (!view) continue;
      this.overrides.delete(id);
      this.paintOverrides(view, {}, true);
    }
    return this;
  }

  /** Swap the look at runtime: a preset name or a (partial) token set. */
  setTheme(theme: ThemePreset | Partial<ThemeTokens>): this {
    const before = this.theme.fontFamily;
    this.theme = resolveTheme(theme);
    // Shapes are sized from the measured text, so a theme with another face re-lays them.
    if (!this.fontOpts.family && this.theme.fontFamily !== before) this.rebuild();
    else this.applyTheme();
    return this;
  }

  /**
   * Set the label type programmatically. Merges over the current settings;
   * `null` for size/weight returns to the document's own values, and
   * `setFont(null)` clears everything. Shapes are re-sized to fit, exactly as
   * the editor sizes them, and the current step and node overrides are kept.
   *
   *   player.setFont({ family: 'Georgia, serif', size: 16 });
   *   player.setFont({ scale: 1.25 });          // 25% larger than the document
   */
  setFont(font: FontOptions | null): this {
    if (this.destroyed) return this;
    this.fontOpts = font ? cleanFont({ ...this.fontOpts, ...font }) : {};
    this.rebuild();
    return this;
  }

  /** The type settings currently in force (a copy). */
  getFont(): FontOptions { return { ...this.fontOpts }; }

  on<K extends PlayerEventName>(event: K, fn: PlayerListener<K>): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as PlayerListener<PlayerEventName>);
    /* STICKY: `ready` and `step` describe current state, so a subscriber that
       arrives after they fired (the normal case after `await fromUrl(…)`)
       still receives them once. Delivered async, like the originals. */
    if (this.isReady && (event === 'ready' || event === 'step')) {
      queueMicrotask(() => {
        if (this.destroyed || !this.listeners.get(event)?.has(fn as PlayerListener<PlayerEventName>)) return;
        const payload = event === 'ready' ? { total: this.total, title: this.diagram.title } : this.stepEvent();
        try { (fn as PlayerListener<PlayerEventName>)(payload as never); }
        catch (error) { this.emit('error', { error: error as Error }); }
      });
    }
    return this;
  }

  off<K extends PlayerEventName>(event: K, fn: PlayerListener<K>): this {
    this.listeners.get(event)?.delete(fn as PlayerListener<PlayerEventName>);
    return this;
  }

  /** Tear down: timers, speech, animations, listeners, DOM. */
  destroy(): void {
    if (this.destroyed) return;
    this.pause();
    this.destroyed = true;
    this.running.forEach((a) => a.cancel());
    this.rootEl.removeEventListener('keydown', this.onKey);
    this.listeners.clear();
    /* Remove only this player's nodes. The shadow root belongs to the host
       element and may already hold the player that replaces this one
       (build new, then destroy old), so clearing the whole root is wrong. */
    this.rootEl.remove();
    this.styleEl.remove();
  }

  /* ============================================================= rebuild === */

  private resolvedFont(): ResolvedFont {
    const f = this.fontOpts;
    return { family: fontStack(f.family, this.theme.fontFamily), size: f.size ?? null, weight: f.weight ?? null, scale: f.scale ?? 1 };
  }

  /** Re-normalise (new text metrics) and redraw, keeping step + overrides. */
  private rebuild(): void {
    this.running.forEach((a) => a.cancel());
    this._diagram = normalize(this.source, this.resolvedFont());
    this.nodes.clear(); this.edges.clear(); this.stepOfNode.clear();
    this._diagram.steps.forEach((s, i) => this.stepOfNode.set(s.nodeId, i));
    const svg = this.buildSvg();
    this.svg.replaceWith(svg);
    this.svg = svg;
    this.applyTheme();
    for (const [id, o] of this.overrides) {
      const v = this.nodes.get(id);
      if (v) this.paintOverrides(v, o); else this.overrides.delete(id);
    }
    this.applyStep(Math.min(this.index, this.total - 1), false);
  }

  /* ============================================================ stepping === */

  private goTo(i: number, animate: boolean): void {
    if (this.destroyed) return;
    this.applyStep(i, animate);
    this.emit('step', this.stepEvent());
    if (this.opts.voice) this.speak();
    if (this.playing) this.scheduleTick(this.opts.stepDuration);
  }

  private scheduleTick(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.playing) return;
      if (this.index < this.total - 1) { this.goTo(this.index + 1, true); return; }
      this.emit('end', { total: this.total });
      if (this.opts.loop) this.goTo(0, true);
      else this.pause();
    }, delay);
  }

  private get motionOk(): boolean {
    if (this.opts.reducedMotion === 'reduce') return false;
    if (this.opts.reducedMotion === 'no-preference') return true;
    return !(this.reduceQuery && this.reduceQuery.matches);
  }

  /** The whole state machine: every node/edge class is a pure function of `i`. */
  private applyStep(i: number, animate: boolean): void {
    const prev = this.index;
    this.index = i;
    const activeId = i >= 0 ? this.diagram.steps[i]?.nodeId ?? null : null;
    const motion = animate && this.motionOk;
    this.rootEl.classList.toggle('is-reduced', !this.motionOk);

    for (const [id, v] of this.nodes) {
      const s = this.stepOfNode.get(id) ?? -1;
      const visible = s <= i && i >= 0;
      v.g.classList.toggle('is-visible', visible);
      v.g.classList.toggle('is-active', id === activeId);
      v.g.classList.toggle('is-past', visible && id !== activeId);
      v.g.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (motion && visible && s > prev) this.animateIn(v.body, (s - prev - 1) * 90);
    }
    for (const v of this.edges.values()) {
      const sa = this.stepOfNode.get(v.from) ?? -1, sb = this.stepOfNode.get(v.to) ?? -1;
      const appearsAt = Math.max(sa, sb);
      const visible = i >= 0 && appearsAt <= i;
      v.g.classList.toggle('is-visible', visible);
      // The pulse runs along the connectors that belong to the active step.
      v.g.classList.toggle('is-pulsing', visible && (v.from === activeId || v.to === activeId));
      if (motion && visible && appearsAt > prev && !v.dashed) this.drawIn(v.line);
    }

    const step = i >= 0 ? this.diagram.steps[i] : undefined;
    this.captionCount.textContent = this.total ? `Step ${Math.max(0, i + 1)} / ${this.total}` : '';
    this.captionNote.textContent = step ? (step.note || this.nodes.get(step.nodeId)?.node.label || '') : (this.diagram.title || '');
    this.captionWhy.textContent = step?.why || '';
    this.captionWhy.hidden = !step?.why;
  }

  private animateIn(el: SVGGElement, delay: number): void {
    if (typeof el.animate !== 'function') return;
    const a = el.animate(
      [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1.03)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 520, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    this.track(a);
  }

  private drawIn(path: SVGPathElement): void {
    if (typeof path.animate !== 'function') return;
    const a = path.animate(
      [{ strokeDasharray: '100 100', strokeDashoffset: 100 }, { strokeDasharray: '100 100', strokeDashoffset: 0 }],
      { duration: 620, delay: 120, easing: 'ease-out', fill: 'backwards' });
    this.track(a);
  }

  private track(a: Animation): void {
    this.running.add(a);
    const done = () => this.running.delete(a);
    a.addEventListener('finish', done);
    a.addEventListener('cancel', done);
  }

  private stepEvent(): StepEvent {
    const step = this.index >= 0 ? this.diagram.steps[this.index] : undefined;
    return {
      index: this.index,
      total: this.total,
      nodeId: step?.nodeId ?? null,
      note: step?.note ?? '',
      why: step?.why ?? '',
      label: step ? this.nodes.get(step.nodeId)?.node.label ?? '' : '',
    };
  }

  private emit<K extends PlayerEventName>(event: K, payload: PlayerEventMap[K]): void {
    this.listeners.get(event)?.forEach((fn) => {
      try { (fn as PlayerListener<K>)(payload); }
      catch (error) { if (event !== 'error') this.emit('error', { error: error as Error }); }
    });
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') { e.preventDefault(); this.pause().next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.pause().prev(); }
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); this.toggle(); }
    else if (e.key === 'Home') { e.preventDefault(); this.pause().goToStep(0); }
    else if (e.key === 'End') { e.preventDefault(); this.pause().goToStep(this.total - 1); }
  }

  /* ---- optional narration voice: the browser's own speech engine ----
     ON-DEVICE VOICES ONLY. Some browser voices (Chrome's "Google …", Edge's
     "… Online (Natural)") send the text to the vendor's servers, and a step
     note is the host page's content. The utterance is given an explicit
     local voice (preferring the page language); with none available the
     player stays silent — it never falls back to the engine default, which
     can itself be an online voice. */
  private localVoice(): SpeechSynthesisVoice | null {
    const all = speechSynthesis.getVoices().filter((v) => v.localService);
    if (!all.length) return null;
    const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase().slice(0, 2);
    return all.find((v) => v.lang.toLowerCase().startsWith(lang) && v.default)
      || all.find((v) => v.lang.toLowerCase().startsWith(lang))
      || all.find((v) => v.default) || all[0] || null;
  }
  private speak(): void {
    if (typeof speechSynthesis === 'undefined') return;
    this.stopVoice();
    const ev = this.stepEvent();
    const text = ev.note || ev.label;
    const voice = this.localVoice();
    if (!text || !voice) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    speechSynthesis.speak(u);
  }
  private stopVoice(): void {
    if (typeof speechSynthesis !== 'undefined' && this.opts.voice) speechSynthesis.cancel();
  }

  /* ============================================================= drawing === */

  private buildSvg(): SVGSVGElement {
    const { bounds, nodes, edges, title } = this.diagram;
    const pad = this.opts.padding;
    const vb = [bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2];
    const svg = svgEl('svg', { viewBox: vb.join(' '), class: 'dgm-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
    const t = svgEl('title', { id: `${this.uid}-title` });
    t.textContent = title || 'Diagram';
    svg.setAttribute('aria-labelledby', `${this.uid}-title`);
    svg.append(t, this.buildDefs(vb));

    // Background: page, faint grid, and (glass) the lit backdrop the frosted nodes blur.
    const bg = svgEl('g', { class: 'dgm-bg' });
    bg.append(svgEl('rect', { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]!, class: 'dgm-page' }));
    bg.append(svgEl('rect', { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]!, class: 'dgm-grid', fill: `url(#${this.uid}-grid)` }));
    const art = svgEl('g', { id: `${this.uid}-backdrop`, class: 'dgm-backdrop' });
    const [bx, by, bw, bh] = vb as [number, number, number, number];
    for (const [fx, fy, fr, cls] of [[0.2, 0.25, 0.32, 'a'], [0.78, 0.3, 0.28, 'b'], [0.55, 0.85, 0.3, 'c']] as const) {
      art.append(svgEl('circle', { cx: bx + bw * fx, cy: by + bh * fy, r: Math.max(bw, bh) * fr, class: `dgm-blob dgm-blob-${cls}` }));
    }
    bg.append(art);
    svg.append(bg);

    const gBack = svgEl('g', { class: 'dgm-back' });      // containers sit beneath the connectors
    const gEdges = svgEl('g', { class: 'dgm-edges' });
    const gNodes = svgEl('g', { class: 'dgm-nodes' });
    const defs = svg.querySelector('defs')!;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    for (const e of edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const { d, mid } = edgePath(a, b, e.bend);
      const g = svgEl('g', { class: 'dgm-edge' + (e.dashed ? ' is-dashed' : ''), 'data-edge-id': e.id });
      const line = svgEl('path', { d, class: 'dgm-line', pathLength: 100, 'marker-end': `url(#${this.uid}-arrow)` });
      const pulse = svgEl('path', { d, class: 'dgm-pulse', pathLength: 100 });
      g.append(line, pulse);
      if (e.label) g.append(this.buildEdgeLabel(e.label, mid.x, mid.y));
      gEdges.append(g);
      this.edges.set(e.id, { g, line, pulse, from: e.from, to: e.to, dashed: e.dashed });
    }

    nodes.forEach((n, idx) => {
      const g = svgEl('g', { class: 'dgm-node', 'data-node-id': n.id, 'data-type': n.type, transform: `translate(${n.cx} ${n.cy})` });
      const body = svgEl('g', { class: 'dgm-node-body' });
      this.applyNodeVars(body, n, defs, idx);
      // Frosted glass: the backdrop, re-drawn blurred and clipped to this shape.
      const clipId = `${this.uid}-clip-${idx}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.append(this.buildShape(n));
      const frost = svgEl('use', { href: `#${this.uid}-backdrop`, x: -n.cx, y: -n.cy, class: 'dgm-frost',
        filter: `url(#${this.uid}-frost)`, 'clip-path': `url(#${clipId})` });
      const shape = this.buildShape(n);
      shape.classList.add('dgm-shape');
      if (n.shape === 'group') shape.classList.add('is-group');
      if (n.color && safeColor(n.color)) shape.classList.add('has-accent');
      if (n.style.opacity != null) shape.setAttribute('fill-opacity', String(Math.max(0, Math.min(1, n.style.opacity))));
      body.append(clip, frost, shape, ...this.buildDecor(n));
      let icon: SVGTextElement | null = null;
      if (n.icon) {
        icon = svgEl('text', { class: 'dgm-icon', x: 0, y: this.iconY(n), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        icon.textContent = n.icon;
        body.append(icon);
      }
      const text = svgEl('text', { class: 'dgm-label', 'dominant-baseline': 'central' });
      body.append(text);
      g.append(body);
      (n.shape === 'group' ? gBack : gNodes).append(g);
      const view: NodeView = { g, body, shape, text, icon, badge: null, node: n };
      this.nodes.set(n.id, view);
      this.renderLabel(view, {});
    });
    svg.append(gBack, gEdges, gNodes);
    return svg;
  }

  /** Per-node colours as CSS variables on the node body, so theme rules,
      the active-step glow and runtime overrides keep their precedence. */
  private applyNodeVars(body: SVGGElement, n: LayoutNode, defs: SVGDefsElement, idx: number): void {
    const st = body.style, sty = n.style;
    const accent = safeColor(n.color);
    if (accent) st.setProperty('--dgm-accent', accent);
    const bc = safeColor(sty.borderColor);
    if (bc) st.setProperty('--dgm-stroke', bc);
    if (sty.borderWidth != null && sty.borderWidth >= 0) st.setProperty('--dgm-sw', String(sty.borderWidth));
    if (sty.borderStyle === 'dashed') st.setProperty('--dgm-dash', '7 4');
    else if (sty.borderStyle === 'dotted') st.setProperty('--dgm-dash', '0.1 6');
    else if (sty.borderStyle === 'none') st.setProperty('--dgm-sw', '0');
    const tint = accent || 'var(--dgm-border)';
    const fill = sty.fill;
    if (fill === 'none' || fill === 'transparent') st.setProperty('--dgm-fill', 'none');
    else if (fill === 'glass') st.setProperty('--dgm-fill', `color-mix(in srgb, ${tint} 7%, transparent)`);
    else if (fill === 'gradient') {
      const id = `${this.uid}-grad-${idx}`;
      const lg = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      const s0 = svgEl('stop', { offset: '0%' }), s1 = svgEl('stop', { offset: '100%' });
      s0.style.setProperty('stop-color', `color-mix(in srgb, ${tint} 38%, transparent)`);
      s1.style.setProperty('stop-color', `color-mix(in srgb, ${tint} 7%, transparent)`);
      lg.append(s0, s1);
      defs.append(lg);
      st.setProperty('--dgm-fill', `url(#${id})`);
    } else {
      const fc = safeColor(fill);
      if (fc) st.setProperty('--dgm-fill', fc);
    }
    const tc = safeColor(sty.textColor);
    if (tc) st.setProperty('--dgm-label', tc);
  }

  private buildDefs(vb: number[]): SVGDefsElement {
    const defs = svgEl('defs');
    const arrow = svgEl('marker', { id: `${this.uid}-arrow`, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    arrow.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 L2.5 5 Z', class: 'dgm-arrowhead' }));
    const grid = svgEl('pattern', { id: `${this.uid}-grid`, width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
    grid.append(svgEl('path', { d: 'M24 0 H0 V24', fill: 'none', class: 'dgm-grid-line' }));
    const frost = svgEl('filter', { id: `${this.uid}-frost`, x: '-20%', y: '-20%', width: '140%', height: '140%' });
    frost.append(svgEl('feGaussianBlur', { stdDeviation: Math.max(vb[2]!, vb[3]!) / 60 }));
    defs.append(arrow, grid, frost);
    return defs;
  }

  /* Shape geometry matching the editor's, in node-local coordinates: the
     centre is (0, 0). */
  private buildShape(n: LayoutNode): SVGGraphicsElement {
    const w = n.w, h = n.h, hw = w / 2, hh = h / 2, x = -hw, y = -hh;
    const r = n.style.cornerRadius ?? (parseFloat(this.theme.borderRadius) || 0);
    const path = (d: string) => svgEl('path', { d });
    switch (n.shape) {
      case 'pill': return svgEl('rect', { x, y, width: w, height: h, rx: hh, ry: hh });
      case 'ellipse': return svgEl('ellipse', { cx: 0, cy: 0, rx: hw, ry: hh });
      case 'circle': return svgEl('circle', { cx: 0, cy: 0, r: Math.min(hw, hh) });
      case 'diamond': return svgEl('polygon', { points: `0,${y} ${hw},0 0,${hh} ${x},0` });
      case 'hexagon': { const k = Math.min(18, w * 0.2); return svgEl('polygon', { points: `${x + k},${y} ${hw - k},${y} ${hw},0 ${hw - k},${hh} ${x + k},${hh} ${x},0` }); }
      case 'parallelogram': { const k = Math.min(14, w * 0.15); return svgEl('polygon', { points: `${x + k},${y} ${hw},${y} ${hw - k},${hh} ${x},${hh}` }); }
      case 'cylinder': {
        const e = Math.min(9, h * 0.18);
        return path(`M ${x} ${y + e} A ${hw} ${e} 0 0 1 ${hw} ${y + e} V ${hh - e} A ${hw} ${e} 0 0 1 ${x} ${hh - e} Z M ${x} ${y + e} A ${hw} ${e} 0 0 0 ${hw} ${y + e}`);
      }
      case 'cloud': {
        const base = y + h * 0.78;
        return path(`M ${x + w * 0.18} ${base} C ${x - w * 0.06} ${base} ${x - w * 0.06} ${y + h * 0.38} ${x + w * 0.2} ${y + h * 0.34}` +
          ` C ${x + w * 0.24} ${y + h * 0.06} ${x + w * 0.62} ${y + h * 0.02} ${x + w * 0.68} ${y + h * 0.3}` +
          ` C ${x + w * 1.04} ${y + h * 0.24} ${x + w * 1.08} ${y + h * 0.7} ${x + w * 0.78} ${base} Z`);
      }
      case 'group': return svgEl('rect', { x, y, width: w, height: h, rx: n.style.cornerRadius ?? 10 });
      case 'actor': return svgEl('circle', { cx: 0, cy: y + 8 + 26, r: 26 });
      case 'document': return path(`M ${x} ${y} H ${hw} V ${hh - 8} Q ${hw / 2} ${hh - 18} 0 ${hh - 8} T ${x} ${hh - 8} Z`);
      case 'manualInput': return path(`M ${x} ${y + 14} L ${hw} ${y} V ${hh} H ${x} Z`);
      case 'manualOperation': { const k = Math.min(18, w * 0.2); return path(`M ${x} ${y} H ${hw} L ${hw - k} ${hh} H ${x + k} Z`); }
      case 'offPage': { const m = y + h * 0.6; return path(`M ${x} ${y} H ${hw} V ${m} L 0 ${hh} L ${x} ${m} Z`); }
      case 'delay': { const k = Math.min(hh, hw); return path(`M ${x} ${y} H ${hw - k} A ${k} ${hh} 0 0 1 ${hw - k} ${hh} H ${x} Z`); }
      case 'display': { const k = Math.min(hh, hw * 0.5); return path(`M ${x} 0 L ${x + 16} ${y} H ${hw - k} A ${k} ${hh} 0 0 1 ${hw - k} ${hh} H ${x + 16} Z`); }
      case 'note': return path(`M ${x} ${y} H ${hw - 11} L ${hw} ${y + 11} V ${hh} H ${x} Z`);
      case 'iconBox': case 'predefined': case 'process': case 'rect':
      default: return svgEl('rect', { x, y, width: w, height: h, rx: r, ry: r });
    }
  }

  /** The extra strokes some shapes carry (subprocess bars, note fold, the actor figure). */
  private buildDecor(n: LayoutNode): SVGElement[] {
    const hw = n.w / 2, hh = n.h / 2, y = -hh;
    const line = (d: string) => svgEl('path', { d, class: 'dgm-deco' });
    switch (n.shape) {
      case 'predefined': return [line(`M ${-hw + 10} ${y} V ${hh} M ${hw - 10} ${y} V ${hh}`)];
      case 'note': return [line(`M ${hw - 11} ${y} V ${y + 11} H ${hw}`)];
      case 'actor': {
        const cy = y + 8 + 26, sw = 15.5, sy = cy + 13.5, by = cy + 17;
        return [
          svgEl('circle', { cx: 0, cy: cy - 10, r: 8.5, class: 'dgm-deco-fill' }),
          svgEl('path', { d: `M ${-sw} ${sy} A ${sw} 12 0 0 1 ${sw} ${sy} L ${sw} ${by} A 23 23 0 0 1 ${-sw} ${by} Z`, class: 'dgm-deco-fill' }),
        ];
      }
      default: return [];
    }
  }

  private iconY(n: LayoutNode): number {
    return -n.h / 2 + Math.min(26, Math.max(15, n.h * 0.3));
  }

  /** Lay the label out the way the editor does: centred (or aligned), in the
      icon box's band under its glyph, at a container's top, under an actor. */
  private renderLabel(v: NodeView, o: NodeStyleOverrides): void {
    const n = v.node, sty = n.style, t = v.text;
    const lines = o.text !== undefined ? String(o.text).replace(/\r\n?/g, '\n').split('\n') : n.lines;
    let fs = typeof o.fontSize === 'number' && o.fontSize > 0 ? o.fontSize : sty.fontSize;
    const family = o.fontFamily ? fontStack(o.fontFamily, sty.fontFamily) : sty.fontFamily;
    const hw = n.w / 2, hh = n.h / 2;
    let cy = 0;
    if (n.shape === 'iconBox') {
      const top = n.icon ? this.iconY(n) + 11 : -hh + 6, bottom = hh - 6;
      const need = lines.length * (fs + 5) - 5;
      if (need > bottom - top) fs = Math.max(7, fs * (bottom - top) / need);
      cy = (top + bottom) / 2;
    } else if (n.shape === 'group') cy = -hh + 13 + ((lines.length - 1) * (fs + 5)) / 2;
    else if (n.shape === 'actor') cy = hh - 20 - ((lines.length - 1) * (fs + 5)) / 2;
    const lh = fs + 5;
    const align = sty.align === 'left' || sty.align === 'right' ? sty.align : 'center';
    const x = align === 'left' ? -hw + 10 : align === 'right' ? hw - 10 : 0;
    t.setAttribute('text-anchor', align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle');
    const ts = t.style;
    ts.setProperty('font-size', `${fs}px`);
    ts.setProperty('font-family', family);
    ts.setProperty('font-weight', String(o.fontWeight ?? sty.fontWeight));
    const italic = o.italic ?? sty.italic;
    if (italic) ts.setProperty('font-style', 'italic'); else ts.removeProperty('font-style');
    if (sty.underline) ts.setProperty('text-decoration', 'underline'); else ts.removeProperty('text-decoration');
    const tc = safeColor(o.textColor);
    if (tc) ts.setProperty('fill', tc); else ts.removeProperty('fill');
    t.replaceChildren();
    const top = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => {
      const span = svgEl('tspan', { x, dy: i === 0 ? top : lh });
      span.textContent = line;                      // untrusted text: never innerHTML
      t.append(span);
    });
  }

  private buildEdgeLabel(label: string, x: number, y: number): SVGGElement {
    const g = svgEl('g', { class: 'dgm-edge-label', transform: `translate(${x} ${y})` });
    const w = measureText(label, this.theme.fontFamily, 10.5, 500) + 12;
    g.append(svgEl('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 9 }));
    const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = label;
    g.append(t);
    return g;
  }

  private paintOverrides(v: NodeView, o: NodeStyleOverrides, reset = false): void {
    const s = v.shape.style;
    if (reset) {
      ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'filter', 'opacity'].forEach((p) => s.removeProperty(p));
      this.renderLabel(v, {});
      v.badge?.remove(); v.badge = null;
      return;
    }
    this.renderLabel(v, o);
    const fill = safeColor(o.fill), stroke = safeColor(o.stroke);
    if (fill) s.setProperty('fill', fill);
    if (stroke) s.setProperty('stroke', stroke);
    if (typeof o.strokeWidth === 'number' && o.strokeWidth >= 0) s.setProperty('stroke-width', String(o.strokeWidth));
    if (typeof o.strokeDasharray === 'string' && /^[\d.\s,]*$/.test(o.strokeDasharray)) s.setProperty('stroke-dasharray', o.strokeDasharray);
    if (typeof o.opacity === 'number') s.setProperty('opacity', String(Math.max(0, Math.min(1, o.opacity))));
    if (o.glow !== undefined) {
      const c = o.glow === true ? this.theme.pulseColor : safeColor(o.glow);
      if (o.glow === false || !c) s.removeProperty('filter');
      else s.setProperty('filter', `drop-shadow(0 0 6px ${c}) drop-shadow(0 0 14px ${c})`);
    }
    if (o.badge !== undefined) {
      v.badge?.remove(); v.badge = null;
      if (o.badge && o.badge.text) {
        const bw = measureText(o.badge.text, this.theme.fontFamily, 10, 700) + 14;
        const g = svgEl('g', { class: 'dgm-badge', transform: `translate(${v.node.w / 2 - bw / 2 - 4} ${-v.node.h / 2})` });
        const rect = svgEl('rect', { x: -bw / 2, y: -9, width: bw, height: 18, rx: 9 });
        const bc = safeColor(o.badge.color);
        if (bc) rect.style.setProperty('fill', bc);
        const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = o.badge.text;
        g.append(rect, t);
        v.body.append(g);
        v.badge = g;
      }
    }
  }

  private applyTheme(): void {
    const t = this.theme, st = this.rootEl.style;
    st.setProperty('--dgm-bg', t.background);
    st.setProperty('--dgm-node-bg', t.nodeBg);
    st.setProperty('--dgm-border', t.borderColor);
    st.setProperty('--dgm-radius', t.borderRadius);
    st.setProperty('--dgm-font', this.resolvedFont().family);
    st.setProperty('--dgm-text', t.textColor);
    st.setProperty('--dgm-muted', t.mutedTextColor || t.textColor);
    st.setProperty('--dgm-connector', t.connectorColor);
    st.setProperty('--dgm-pulse', t.pulseColor);
    st.setProperty('--dgm-grid', t.gridColor || 'transparent');
    this.rootEl.classList.toggle('is-glass', !!t.glass);
    // Corner radius is geometry, not a CSS property on <rect>: update in place
    // (only for boxes that do not carry their own saved cornerRadius).
    const r = parseFloat(t.borderRadius) || 0;
    for (const v of this.nodes.values()) {
      const k = v.node.shape;
      if (v.node.style.cornerRadius == null && (k === 'rect' || k === 'process' || k === 'iconBox' || k === 'predefined')) {
        v.shape.setAttribute('rx', String(r)); v.shape.setAttribute('ry', String(r));
      }
    }
  }
}

/** Keep only well-formed font settings (hosts may pass anything at runtime). */
function cleanFont(f: FontOptions | null | undefined): FontOptions {
  if (!f || typeof f !== 'object') return {};
  const out: FontOptions = {};
  if (typeof f.family === 'string' && f.family.trim()) out.family = f.family.trim();
  if (typeof f.size === 'number' && isFinite(f.size) && f.size > 0) out.size = Math.min(f.size, 200);
  if (typeof f.weight === 'number' && isFinite(f.weight) && f.weight > 0) out.weight = Math.min(Math.max(f.weight, 100), 1000);
  if (typeof f.scale === 'number' && isFinite(f.scale) && f.scale > 0) out.scale = Math.min(f.scale, 8);
  return out;
}

export { DiagramiumFormatError };

/* ================================================================ styles ===
   Everything visual is a CSS custom property set from the theme tokens, so a
   theme swap is a variable update, not a re-render. */
const PLAYER_CSS = `
:host { display: block; }
.dgm-root { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
  background: var(--dgm-bg); color: var(--dgm-text); font-family: var(--dgm-font);
  border-radius: 12px; overflow: hidden; outline: none; }
.dgm-root:focus-visible { box-shadow: 0 0 0 2px var(--dgm-pulse); }
.dgm-svg { display: block; width: 100%; flex: 1 1 auto; min-height: 0; }
.dgm-page { fill: var(--dgm-bg); }
.dgm-grid-line { stroke: var(--dgm-grid); stroke-width: 1; }
.dgm-backdrop { display: none; }
.is-glass .dgm-backdrop { display: inline; }
.dgm-blob { opacity: .55; filter: blur(40px); }
.dgm-blob-a { fill: #7C3AED; } .dgm-blob-b { fill: #0EA5E9; } .dgm-blob-c { fill: #EC4899; }
.dgm-frost { display: none; }
.is-glass .dgm-frost { display: inline; }

/* ---- nodes ---- */
.dgm-node { opacity: 0; transition: opacity .35s ease; }
.dgm-node.is-visible { opacity: 1; }
.dgm-node.is-past { opacity: .78; }
.dgm-node-body { transform-box: fill-box; transform-origin: center; }
.dgm-shape { fill: var(--dgm-fill, var(--dgm-node-bg)); stroke: var(--dgm-stroke, var(--dgm-border));
  stroke-width: var(--dgm-sw, 1.2); stroke-dasharray: var(--dgm-dash, none); stroke-linecap: round;
  transition: stroke .3s ease, filter .3s ease; }
.dgm-shape.has-accent { stroke: var(--dgm-stroke, var(--dgm-accent));
  fill: var(--dgm-fill, color-mix(in srgb, var(--dgm-accent) 14%, var(--dgm-node-bg))); }
.dgm-shape.is-group { fill: var(--dgm-fill, color-mix(in srgb, var(--dgm-accent, var(--dgm-border)) 5%, transparent));
  stroke-dasharray: var(--dgm-dash, 7 5); }
.is-glass .dgm-shape { fill: var(--dgm-fill, rgba(255,255,255,.08)); stroke: var(--dgm-stroke, rgba(255,255,255,.3));
  filter: drop-shadow(0 10px 24px rgba(0,0,0,.35)); }
.is-glass .dgm-shape.is-group { fill: var(--dgm-fill, rgba(255,255,255,.03)); filter: none; }
.dgm-deco { fill: none; stroke: var(--dgm-stroke, var(--dgm-accent, var(--dgm-border))); stroke-width: var(--dgm-sw, 1.2); }
.dgm-deco-fill { fill: var(--dgm-stroke, var(--dgm-accent, var(--dgm-border))); stroke: none; }
.dgm-icon { font-size: 21px; pointer-events: none; }
.dgm-label { fill: var(--dgm-label, var(--dgm-text)); font-family: var(--dgm-font); font-size: 12.5px; font-weight: 600;
  pointer-events: none; }
.dgm-node.is-active .dgm-shape { stroke: var(--dgm-pulse); stroke-width: 1.8;
  filter: drop-shadow(0 0 5px var(--dgm-pulse)) drop-shadow(0 0 14px color-mix(in srgb, var(--dgm-pulse) 55%, transparent));
  animation: dgm-breathe 2.4s ease-in-out infinite; }
@keyframes dgm-breathe { 50% { filter: drop-shadow(0 0 2px var(--dgm-pulse)) drop-shadow(0 0 8px color-mix(in srgb, var(--dgm-pulse) 35%, transparent)); } }
.dgm-badge rect { fill: var(--dgm-pulse); }
.dgm-badge text { fill: #fff; font: 700 10px var(--dgm-font); }

/* ---- edges ---- */
.dgm-edge { opacity: 0; transition: opacity .35s ease; }
.dgm-edge.is-visible { opacity: 1; }
.dgm-line { fill: none; stroke: var(--dgm-connector); stroke-width: 1.5; stroke-linecap: round; }
.dgm-edge.is-dashed .dgm-line { stroke-dasharray: 5 4; }
.dgm-arrowhead { fill: var(--dgm-connector); }
.dgm-pulse { fill: none; stroke: var(--dgm-pulse); stroke-width: 2.4; stroke-linecap: round; opacity: 0;
  stroke-dasharray: 9 91; filter: drop-shadow(0 0 3px var(--dgm-pulse)) drop-shadow(0 0 8px var(--dgm-pulse)); }
.dgm-edge.is-pulsing .dgm-pulse { opacity: 1; animation: dgm-pulse 1.5s linear infinite; }
.dgm-edge.is-pulsing .dgm-line { stroke: color-mix(in srgb, var(--dgm-pulse) 45%, var(--dgm-connector)); }
@keyframes dgm-pulse { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
.dgm-edge-label rect { fill: var(--dgm-bg); stroke: var(--dgm-border); stroke-width: 1; }
.dgm-edge-label text { fill: var(--dgm-muted); font: 500 10.5px var(--dgm-font); }

/* ---- caption ---- */
.dgm-caption { flex: none; display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; align-items: baseline;
  padding: 12px 16px 14px; border-top: 1px solid var(--dgm-border); }
.dgm-caption[hidden] { display: none; }
.dgm-count { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em;
  text-transform: uppercase; color: var(--dgm-pulse); white-space: nowrap; }
.dgm-note { margin: 0; font-size: 14px; line-height: 1.55; color: var(--dgm-text); }
.dgm-why { grid-column: 2; margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--dgm-muted); }
.dgm-why[hidden] { display: none; }

/* ---- reduced motion: the state is still shown, nothing moves ---- */
.is-reduced .dgm-node, .is-reduced .dgm-edge { transition: none; }
.is-reduced .dgm-edge.is-pulsing .dgm-pulse { animation: none; stroke-dasharray: none; opacity: .9; }
.is-reduced .dgm-node.is-active .dgm-shape { animation: none; }
`;
