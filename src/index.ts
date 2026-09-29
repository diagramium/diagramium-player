/**
 * diagramium-player — framework-agnostic playback engine for Diagramium diagrams.
 *
 *   import { DiagramiumPlayer } from 'diagramium-player';
 *   const player = new DiagramiumPlayer({ container: '#diagram', source: json, theme: 'linear-midnight' });
 *   player.on('step', (e) => console.log(e.index, e.note)).play();
 */
export { DiagramiumPlayer, DiagramiumFormatError } from './player';
export { normalize as parseDiagram } from './adapter';
export { THEME_PRESETS } from './themes';
export type * from './types';
