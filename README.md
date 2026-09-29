# diagramium-player

Play [Diagramium](https://www.diagramium.com) diagrams step by step in any web page — animated, with captions, and fully programmable from your own code.

- **Native files, no converter.** Plays the editor's saved `.json` (File → Save) and the public gallery's diagram files as they are.
- **Zero runtime dependencies.** Plain DOM, SVG, CSS and the Web Animations API — about 14 KB gzipped.
- **Isolated.** Mounts in a shadow root: your CSS can't break it, its CSS can't leak.
- **Programmable.** Chainable controls, step events, live node restyling, fonts and themes.
- **Private by design.** It makes no network requests of its own, sets no cookies, and collects nothing.

```bash
npm install diagramium-player
```

```ts
import { DiagramiumPlayer } from 'diagramium-player';

const player = await DiagramiumPlayer.fromUrl('/diagrams/checkout.json', {
  container: '#diagram',
  theme: 'linear-midnight',          // 'bento-card' | 'glassmorphism' | { ...tokens }
});

player
  .on('step', (e) => highlightDocs(e.index, e.note))
  .play();

// live data
player.updateNodeStyle('n5', { text: 'Redis\n12 ms', stroke: '#22c55e', glow: true, badge: { text: 'healthy' } });
```

Or without a bundler:

```html
<div id="diagram" style="height: 480px"></div>
<script type="module">
  import { DiagramiumPlayer } from 'https://cdn.jsdelivr.net/npm/diagramium-player/dist/index.js';
  DiagramiumPlayer.fromUrl('/my-diagram.json', { container: '#diagram', autoplay: true });
</script>
```

## Options

| Option | Default | |
| --- | --- | --- |
| `container` | — | Element or selector to mount into. |
| `source` | — | A parsed Diagramium document or its JSON text (use `fromUrl` for a URL). |
| `theme` | `'linear-midnight'` | A preset name or a (partial) token set. |
| `autoplay` | `false` | Start playing on mount. |
| `stepDuration` | `2600` | Milliseconds per step while playing. |
| `loop` | `false` | Start again after the last step. |
| `initialStep` | `0` | `-1` = empty stage, `'all'` = the finished diagram. |
| `showCaption` | `true` | The built-in caption bar with each step's note. |
| `voice` | `false` | Read notes aloud with an on-device browser voice (silent if the browser has none). |
| `keyboard` | `true` | ← → step, Space play/pause, Home / End. |
| `reducedMotion` | `'auto'` | Follows `prefers-reduced-motion`; `'reduce'` / `'no-preference'` to force. |
| `font` | — | `{ family, size, weight, scale }` — see Fonts. |
| `padding` | `40` | Space around the diagram, in document units. |
| `ariaLabel` | the title | Accessible name for the diagram. |

## API

| Method | |
| --- | --- |
| `play()` / `pause()` / `toggle()` | Run or halt the step sequence. |
| `next()` / `prev()` | Move exactly one step (next animates in; prev is instant). |
| `goToStep(index)` | Seek instantly. `-1` empties the stage; values clamp. |
| `goToNode(nodeId)` | Seek to the step that reveals a node. |
| `updateNodeStyle(id, overrides)` | `text`, `fill`, `stroke`, `strokeWidth`, `strokeDasharray`, `textColor`, `glow`, `opacity`, `badge`, `fontSize`, `fontFamily`, `fontWeight`, `italic`. Persists across seeks. |
| `resetNodeStyle(id?)` | Drop overrides on one node, or all. |
| `setTheme(presetOrTokens)` | Swap the look without re-rendering. |
| `setFont(font)` / `getFont()` | Set label type for the whole diagram (see below). `setFont(null)` returns to the document's own fonts. |
| `on(event, fn)` / `off(...)` | `ready`, `step`, `play`, `pause`, `end`, `error`. `ready` and `step` are sticky: a late subscriber immediately gets the current state. |
| `destroy()` | Remove everything. |

Every method except `destroy` and `getFont` returns the player, so calls chain.

### Fonts

```js
new DiagramiumPlayer({ container, source, font: { family: 'Georgia, serif', size: 16 } });

player.setFont({ size: 18 });            // every label 18px; shapes grow to fit, like the editor
player.setFont({ scale: 1.25 });         // keep the document's sizes, 25% larger
player.setFont({ family: 'mono' });      // editor keys work: inter, serif, mono, slab, rounded, handwriting…
player.setFont({ size: null });          // back to each node's saved fontSize
player.setFont(null);                    // clear everything
```

`family` is a CSS font list or an editor font key; `size` and `weight` apply to every node (`null` = the document's own); `scale` multiplies whatever size wins. A node's own saved `fontFamily` still wins over `family`. The step you are on and any `updateNodeStyle` overrides survive the re-layout.

### Shapes and per-node styles

Nodes draw the way the editor draws them: icon boxes (service ⚙️, cache ⚡, queue 📨, database, gateway…) with their glyph, capped cylinders, clouds, diamonds, pills, containers (dashed, behind the arrows), the flowchart set (document, manual input, predefined process, off-page, delay, display) and UML actors. Saved per-node `fontSize`, `fontFamily`, `bold`, `italic`, `underline`, `textColor`, `fill` (a colour, `glass`, `gradient`, `none`), `color`, `borderColor`, `borderWidth`, `borderStyle`, `cornerRadius`, `opacity`, `align`, `w` and `h` are honoured. The icon table (`src/shapes.generated.ts`) is generated from the editor's shape catalogue by maintainers.

Keyboard (when focused): ← → step, Space play/pause, Home / End.

## Supported documents

Every **node-edge** diagram: flowchart, architecture, data flow, state machine, ER, UML class, C4, network, BPMN, process map, decision tree, concept map, swimlane, timeline, journey map, mind map (auto-laid-out) and more — about 90% of the Diagramium catalogue. Text-script documents (sequence diagrams, org charts, sitemaps) are rejected with a clear `DiagramiumFormatError` for now.

Step order follows the editor's contract: step *N* reveals the *N*th node (or the *N*th entry of the document's `order`), and a connector appears once both of its ends are on stage.

## Browser support

Current Chrome, Edge, Firefox and Safari (it uses shadow DOM, the Web Animations API and CSS `color-mix()`). Rendering needs a browser; `parseDiagram()` also runs in Node.

## Security and privacy

Diagram files are treated as untrusted input: text reaches the page only through `textContent`, never as HTML, and colours and font names are validated before use. The player sends nothing anywhere — `fromUrl` fetches only the URL you give it, without cookies. With `voice: true` it uses only voices the browser reports as on-device, so step notes are not sent to an online speech service.

Found a security problem? See [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Develop

```bash
npm install
npm run dev        # demo page at http://localhost:5173 (index.html):
                   #   pick an example, or Open / drop any Diagramium .json
npm run typecheck
npm test           # builds, then runs the headless tests in tests/
npm run build      # dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts
```

## License

The code is [MIT](LICENSE) © 2026 DhuRee Labs Inc.

The example diagrams in `examples/` are not covered by the MIT licence — see [examples/README.md](examples/README.md).
