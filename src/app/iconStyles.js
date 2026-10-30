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

// Built-in options (placeholders the owner can replace with own files later) for the icons that have no imported set: the filter panel's
// Song Title / Artist / Album Title length, Song Date and Song Length rows, and the Play On Device button. Option 0 is the icon each one always had.
// A shape is [pathData, evenOdd] on the same 42.52 box; every icon is filled shapes in the current colour.
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}z`;
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const C = 21.26;
export const EXTRA_ICON_SETS = {
    ln: [ // Song Title Length
        { name: 'Letter T', p: [['M7 7h28.5v6.5H24.6V36h-6.7V13.5H7z', 0]] },
        { name: 'Text Lines', p: [[rect(5, 9, 32.5, 5) + rect(5, 19, 24, 5) + rect(5, 29, 28, 5), 0]] },
        { name: 'Letter A With Ruler', p: [['M3 27L11.5 4h5L25 27h-5l-1.4-4.5H9.4L8 27zM10.8 18.5h6.4L14 9z', 1], [rect(3, 33, 36.5, 3) + rect(3, 30, 3, 9) + rect(36.5, 30, 3, 9), 0]] },
    ],
    la: [ // Artist Name Length
        { name: 'Person', p: [[circ(21.26, 13, 8), 0], ['M5 37c0-8.5 7-13 16.26-13S37.5 28.5 37.5 37z', 0]] },
        { name: 'Microphone', p: [['M16.3 11a5 5 0 0 1 10 0v10a5 5 0 0 1-10 0z', 0], ['M10 19h3a8.3 8.3 0 0 0 16.6 0h3a11.3 11.3 0 0 1-9.8 11.2V36h5v3H15v-3h5v-5.8A11.3 11.3 0 0 1 10 19z', 0]] },
        { name: 'Two People', p: [[circ(15, 14, 6.5), 0], ['M2.5 36c0-7.5 5.5-11.5 12.5-11.5S27.5 28.5 27.5 36z', 0], [circ(30, 15, 5), 0], ['M28.5 25c6.5 0 11.5 3.5 11.5 10.5h-9.5c0-4-1-7.5-2-10.5z', 0]] },
    ],
    lb: [ // Album Title Length
        { name: 'Record', p: [[circ(C, C, 17.26) + circ(C, C, 4.5), 1]] },
        { name: 'Stacked Covers', p: [[rect(4, 12, 26.5, 26.5) + rect(8, 16, 18.5, 18.5), 1], ['M12 6h26.5v26.5h-4V10H12z', 0]] },
        { name: 'Disc In Sleeve', p: [[rect(4, 4, 34.5, 34.5) + rect(8, 8, 26.5, 26.5), 1], [circ(C, C, 9) + circ(C, C, 3), 1]] },
    ],
    rd: [ // Song Date
        { name: 'Calendar', p: [['M11 4h4.5v5h11.5V4h4.5v5h4a2.5 2.5 0 0 1 2.5 2.5v22a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-22A2.5 2.5 0 0 1 7 9h4zM9 18v15.5h24.5V18z', 1]] },
        { name: 'Hourglass', p: [['M8 4h26.5v5c0 7-6 10-8 12.3 2 2.3 8 5.3 8 12.2v5H8v-5c0-6.9 6-9.9 8-12.2C14 19 8 16 8 9z', 0]] },
        { name: 'Price Tag', p: [['M4 4h17l17.5 17.5-17 17L4 21zM11.5 8.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 1]] },
    ],
    du: [ // Song Length
        { name: 'Clock', p: [[circ(C, C, 17.26) + circ(C, C, 13.5), 1], ['M19.4 11.5h3.7v9.2l6.4 3.7-1.85 3.2-8.25-4.8z', 0]] },
        { name: 'Stopwatch', p: [[circ(C, 24, 15) + circ(C, 24, 11.5), 1], [rect(19.4, 15, 3.7, 10), 0], [rect(16, 3.5, 10.5, 4) + rect(19.4, 7.5, 3.7, 4), 0]] },
        { name: 'Progress Bar', p: [[rect(3, 15.5, 36.5, 11) + rect(6, 18.5, 30.5, 5), 1], [rect(6, 18.5, 14, 5), 0]] },
    ],
    device: [ // Play On Device button
        { name: 'Screen And Phone', p: [[rect(3, 6, 26.5, 19.5) + rect(6, 9, 20.5, 13.5), 1], [rect(12, 28, 8.5, 3) + rect(9, 31, 14.5, 3), 0], [rect(31, 13, 8.5, 21) + rect(33.5, 16, 3.5, 13), 1]] },
        { name: 'Speaker', p: [[rect(9, 4, 24.5, 34.5) + rect(12, 7, 18.5, 28.5), 1], [circ(C, 15, 3.5), 0], [circ(C, 27, 6.5), 0]] },
        { name: 'Cast Screen', p: [['M5 8h32.5v26H25v-3h9.5V11H8v5H5z', 0], ['M5 21.5V25A11 11 0 0 1 16 36h3.5A14.5 14.5 0 0 0 5 21.5z', 0], ['M5 28.5V32a4 4 0 0 1 4 4h3.5A7.5 7.5 0 0 0 5 28.5z', 0], [circ(7.5, 34.5, 2.5), 0]] },
        { name: 'Headphones', p: [['M6 27V21.3a15.26 15.26 0 0 1 30.52 0V27h-4v-5.7a11.26 11.26 0 0 0-22.52 0V27z', 0], [rect(4, 25, 9, 14), 0], [rect(29.5, 25, 9, 14), 0]] },
        { name: 'Broadcast', p: [[circ(C, C, 4), 0], [circ(C, C, 10) + circ(C, C, 7.5), 1], [circ(C, C, 17.26) + circ(C, C, 14.5), 1]] },
    ],
};
const extraPick = (key, i) => { const l = EXTRA_ICON_SETS[key]; return l[Math.min(iconIndex(i), l.length - 1)]; };
export const extraIconHtml = (key, i) => shapes(extraPick(key, i));
export function applyDeviceIcon(svg, i) { setIcon(svg, 'devc' + i, shapes(extraPick('device', i))); }
