// Icon styles for the player's buttons. Each group (Volume, Shuffle, Next/Last, Play, Pause) has 15 styles, numbered 0-14 in its dev-panel
// dropdown. A style is one of 5 shape families combined with 3 treatments (volume: 5 speakers x 3 wave styles; shuffle: 5 glyphs x 3
// stroke weights). The first family/treatment is the original look, so style 0 is what the app showed before the dropdowns existed.

const TREATMENTS = [
    'fill:currentColor;stroke:none',                                                  // solid
    'fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round',             // outline
    'fill:currentColor;stroke:currentColor;stroke-width:1.2;stroke-linejoin:round',   // solid with a thin edge
];
const SPEAKERS = [
    'M4 9v6h4l5 4V5L8 9H4z',
    'M3 8.5v7h4.5L13 20V4L7.5 8.5H3z',
    'M4 8h4l5-4v16l-5-4H4z',
    'M5 9h3l6-5v12l-6-5H5z',
    'M3 10h4l6-5v14l-6-5H3z',
];
const WAVES = [
    { w1: 'M16 9.5a4 4 0 0 1 0 5', w2: 'M18.5 7a7.5 7.5 0 0 1 0 10', w3: 'M21 4.5a11 11 0 0 1 0 15' },   // arcs
    { w1: 'M16.5 9v6', w2: 'M19.5 7v10', w3: 'M22.5 5v14' },                                         // bars
    { w1: 'M15.5 8.5a5 5 0 0 1 0 7', w2: 'M18.5 6a9 9 0 0 1 0 12', w3: 'M21.5 3.5a13 13 0 0 1 0 17' }, // wide arcs
];
const MUTE_X = 'M16 9l6 6M22 9l-6 6';
const SHUFFLE_GLYPHS = [
    'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
    'M3 7h4l10 10h4M3 17h4L17 7h4M17 4l3 3-3 3M17 14l3 3-3 3',
    'M4 6c6 0 6 12 16 12M4 18c6 0 6-12 16-12M17 3l3 3-3 3M17 15l3 3-3 3',
    'M3 7h11M3 17h11M14 4l3 3-3 3M14 14l3 3-3 3M17 7h4M17 17h4',
    'M3 17h4l5-10h3M13 17h4l2-3M3 7h4l5 10h3M18 4l3 3-3 3',
];
const SHUFFLE_WEIGHTS = [1.6, 2, 2.6];
const NAV_SHAPES = [
    'M6 5v14l12-7z',
    'M4 5v14l8-7zM12 5v14l8-7z',
    'M5 5v14l11-7zM18 5h2v14h-2z',
    'M8 5l8 7-8 7',
    'M6 6.5v11a1 1 0 0 0 1.5.9l9.5-5.5a1 1 0 0 0 0-1.8L7.5 5.6A1 1 0 0 0 6 6.5z',
];
const PLAY_SHAPES = [
    'M7 4l13 8-13 8z',
    'M7 5.2v13.6a1 1 0 0 0 1.5.85l10.8-6.8a1 1 0 0 0 0-1.7L8.5 4.35A1 1 0 0 0 7 5.2z',
    'M5 4l9 8-9 8zM13 4l9 8-9 8z',
    'M8 4l11 8-11 8',
    'M8 6l10 6-10 6z',
];
const PAUSE_SHAPES = [
    'M6 4h4v16H6zM14 4h4v16h-4z',
    'M6.8 4h2.4a.8.8 0 0 1 .8.8v14.4a.8.8 0 0 1-.8.8H6.8a.8.8 0 0 1-.8-.8V4.8a.8.8 0 0 1 .8-.8zM14.8 4h2.4a.8.8 0 0 1 .8.8v14.4a.8.8 0 0 1-.8.8h-2.4a.8.8 0 0 1-.8-.8V4.8a.8.8 0 0 1 .8-.8z',
    'M8 4v16M16 4v16',
    'M5 4h5v16H5zM14 4h5v16h-5z',
    'M7 6h3v12H7zM14 6h3v12h-3z',
];

// Dropdown value -> style index (0-14). Anything unreadable falls back to style 0.
export const iconIndex = v => Math.max(0, Math.min(14, parseInt(v, 10) || 0));

// Rewrites an icon's SVG only when its style changed, so a settings change that does not touch the icon costs nothing.
function setIcon(svg, key, html) {
    if (!svg || svg.dataset.icon === key) return;
    svg.dataset.icon = key;
    svg.innerHTML = html;
}

export function applyVolumeIcon(svg, i) {
    const w = WAVES[i % 3];
    setIcon(svg, 'vol' + i, `<path class="spk" d="${SPEAKERS[Math.floor(i / 3)]}"/><path class="w1" d="${w.w1}"/><path class="w2" d="${w.w2}"/><path class="w3" d="${w.w3}"/><path class="x" d="${MUTE_X}"/>`);
}

export function applyShuffleIcon(svg, i) {
    if (!svg) return;
    setIcon(svg, 'shuf' + i, `<path d="${SHUFFLE_GLYPHS[Math.floor(i / 3)]}"/>`);
    svg.style.strokeWidth = String(SHUFFLE_WEIGHTS[i % 3]);
}

// Previous song is the next-song shape mirrored (one shape set for both buttons).
export function applyNavIcon(svg, i, mirrored) {
    // The triangle's visual centre sits 2 units left of its box centre: shift it onto the centre, where the click and hover are.
    if (svg) svg.setAttribute('viewBox', Math.floor(i / 3) === 0 ? (mirrored ? '2 0 24 24' : '-2 0 24 24') : '0 0 24 24');
    setIcon(svg, 'nav' + i + (mirrored ? 'm' : ''), `<path d="${NAV_SHAPES[Math.floor(i / 3)]}" style="${TREATMENTS[i % 3]}"${mirrored ? ' transform="matrix(-1 0 0 1 24 0)"' : ''}/>`);
}

export function applyPlayIcon(svg, i) {
    setIcon(svg, 'play' + i, `<path d="${PLAY_SHAPES[Math.floor(i / 3)]}" style="${TREATMENTS[i % 3]}"/>`);
}

// The cover's play/pause glyph: both shapes are in the SVG; the cover's CSS shows whichever matches its state.
export function applyCoverGlyph(svg, playI, pauseI) {
    setIcon(svg, 'glyph' + playI + '-' + pauseI,
        `<path class="ico-play" d="${PLAY_SHAPES[Math.floor(playI / 3)]}" style="${TREATMENTS[playI % 3]}"/>` +
        `<path class="ico-pause" d="${PAUSE_SHAPES[Math.floor(pauseI / 3)]}" style="${TREATMENTS[pauseI % 3]}"/>`);
}

// Filter button: 15 genuinely different drawings (not one shape in several weights). Each is a list of [path, filled?]; the SVG's own
// stroke / fill settings (app.css .spx-filter svg) draw the outlines.
const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
export const FILTER_ICON_NAMES = ['Funnel', 'Sliders', 'Equalizer', 'Magnifier', 'Checklist', 'Tuner Dials', 'Sort Bars', 'Sieve', 'Toggle', 'Eye', 'Tag', 'Star', 'Target', 'Magic Wand', 'Layers'];
const FILTER_ICONS = [
    [['M3 5h18l-7 8v6l-4-2v-4z']],
    [['M4 6h16M4 12h16M4 18h16'], [C(8, 6, 2), 1], [C(16, 12, 2), 1], [C(9, 18, 2), 1]],
    [['M5 20v-8M10 20V5M15 20v-11M20 20v-6']],
    [['M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z'], ['M15 15l6 6']],
    [['M3.5 5l1.5 1.5L8 3.5M3.5 12l1.5 1.5L8 10.5M3.5 19l1.5 1.5L8 17.5'], ['M12 5h9M12 12h9M12 19h9']],
    [['M7 3v18M17 3v18'], ['M4.5 8h5v4h-5z', 1], ['M14.5 13h5v4h-5z', 1]],
    [['M3 6h18M3 12h12M3 18h6']],
    [['M3 9h18a9 9 0 0 1-18 0z'], ['M8 13h.01M12 15.5h.01M16 13h.01M12 11.5h.01']],
    [['M8 6.5h8a5.5 5.5 0 0 1 0 11H8a5.5 5.5 0 0 1 0-11z'], [C(16, 12, 2.2), 1]],
    [['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], [C(12, 12, 3)]],
    [['M3 12.5V4h8.5l9.5 9.5-8.5 8.5z'], ['M7.5 8h.01']],
    [['M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17l-5.6 3.2 1.2-6.3L3 9.6l6.3-.8z']],
    [[C(12, 12, 9)], [C(12, 12, 4.5)], ['M12 12h.01']],
    [['M4 20L15 9'], ['M18 2.5l1.2 2.8L22 6.5l-2.8 1.2L18 10.5l-1.2-2.8L14 6.5l2.8-1.2z', 1], ['M7 4v3M5.5 5.5h3']],
    [['M12 3l9 5-9 5-9-5z'], ['M3 12.5l9 5 9-5'], ['M3 17l9 5 9-5']],
];
export function applyFilterIcon(svg, i) {
    if (!svg) return;
    const parts = FILTER_ICONS[i] || FILTER_ICONS[0];
    setIcon(svg, 'filt' + i, parts.map(([d, filled]) => `<path d="${d}"${filled ? ' style="fill:currentColor"' : ''}/>`).join(''));
}
