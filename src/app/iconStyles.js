// Icons for the player's buttons. Each button's dev-panel dropdown lists the owner's own icon files (data/BUTTON ICONS, turned into
// buttonIcons.js by scripts/active/build_button_icons.js). Every icon is filled shapes in the current colour on a 42.52 box.
import { BUTTON_ICONS, ICON_BOX } from './buttonIcons.js';

// Dropdown value -> icon number in that button's list. Anything unreadable falls back to the first icon.
export const iconIndex = v => Math.max(0, parseInt(v, 10) || 0);

const pick = (key, i) => { const list = BUTTON_ICONS[key]; return list[Math.min(i, list.length - 1)]; };
const FILL = 'fill:currentColor;stroke:none'; // beats the button CSS' stroke-based defaults
// A shape is [pathData, evenOdd, transform?]: the optional transform comes from an imported SVG (its viewBox scaling / group transforms).
const shapes = (icon, cls) => icon.p.map(([d, eo, t]) => `<path${cls ? ` class="${cls}"` : ''} d="${d}"${eo ? ' fill-rule="evenodd"' : ''}${t ? ` transform="${t}"` : ''} style="${FILL}"/>`).join('');
// Bumped whenever an icon is imported or overwritten: every icon's "already drawn" key includes it, so a changed icon is redrawn.
let iconRevision = 0;
export const iconRev = () => iconRevision;
export const bumpIconRevision = () => { iconRevision++; };

// Rewrites an icon's SVG only when its choice changed, so a settings change that does not touch the icon costs nothing.
function setIcon(svg, key, html) {
    if (!svg) return;
    svg.setAttribute('viewBox', `0 0 ${ICON_BOX} ${ICON_BOX}`);
    key += ':' + iconRevision;
    if (svg.dataset.icon === key) return;
    svg.dataset.icon = key;
    svg.innerHTML = html;
}

export function applyVolumeIcon(svg, i) { setIcon(svg, 'vol' + i, shapes(pick('volume', i), 'spk')); }
export function applyShuffleIcon(svg, i) { setIcon(svg, 'shuf' + i, shapes(pick('shuffle', i))); }

// Previous song is the next-song icon mirrored (one icon set for both buttons).
export function applyNavIcon(svg, i, mirrored) {
    const body = shapes(pick('nav', i));
    setIcon(svg, 'nav' + i + (mirrored ? 'm' : ''), mirrored ? `<g transform="matrix(-1 0 0 1 ${ICON_BOX} 0)">${body}</g>` : body);
}

export function applyPlayIcon(svg, i) { setIcon(svg, 'play' + i, shapes(pick('play', i))); }

// The cover's play/pause glyph: both icons are in the SVG; the cover's CSS shows whichever matches its state.
export function applyCoverGlyph(svg, playI, pauseI) {
    setIcon(svg, 'glyph' + playI + '-' + pauseI, `<g class="ico-play">${shapes(pick('play', playI))}</g><g class="ico-pause">${shapes(pick('pause', pauseI))}</g>`);
}

export function applyFilterIcon(svg, i) { setIcon(svg, 'filt' + i, shapes(pick('filter', i))); }
export function applySongDataIcon(svg, i) { setIcon(svg, 'sdata' + i, shapes(pick('data', i))); }

// The four audio-feature icons (filter panel and Song Data row): key is tp / v / dn / e. Returns the icon's SVG markup and its shapes.
export const featureIcon = (key, i) => pick(key, iconIndex(i));
export const featureIconHtml = (key, i) => shapes(featureIcon(key, i));
// Any other icon (the filter panel's name / date / length rows): a list of [pathData, evenOdd] shapes on the same box.
export const customIconHtml = icon => shapes({ p: icon });
export { ICON_BOX };
