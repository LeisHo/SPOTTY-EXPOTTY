// Reads live values from the dev panel's controls, falling back to defaults when
// the panel isn't built (a normal visitor never builds it). The dev panel owns
// the values; this module never stores a copy -- one source of truth.
//
// Control ids follow the dev panel convention: a Desktop control `sliderFoo` has
// Mobile/Landscape twins `sliderMobileFoo` / `sliderLandscapeFoo`. A twin exists
// only when "Show in Mobile/Landscape" is checked, so fall back to the Desktop id.

export const DEFAULTS = {
    checkboxScrubAudioEnabled: true,
    sliderScrubVolume: 0.7,
    sliderClipStartMin: 2,
    sliderClipStartMax: 22,
    sliderClipFadeOut: 30,
    checkboxColdStartClips: true,
    sliderPreloadAhead: 8,
    sliderPreloadBehind: 3,
    checkboxShowPoolOverlay: false,
    sliderSongsPerWheelNotch: 1,
    sliderSongsPerDrag100: 12,
    checkboxInvertScroll: false,
    checkboxHandoffEnabled: true,
    sliderHandoffDelay: 600,
    colorTimelineAccent: '#1db954',
    colorTimelinePlayhead: '#ffffff',
    sliderTimelineHeight: 200,
    sliderTimelineBarOpacity: 0.8,
};

export function activeDevice() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w > h && h <= 500) return 'Landscape';
    if (w <= 768) return 'Mobile';
    return '';
}

function readEl(el) {
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return parseFloat(el.value);
    return el.value;
}

export function setting(id) {
    const m = id.match(/^(slider|color|select|checkbox)(.+)$/);
    const dev = activeDevice();
    if (dev && m) {
        const v = readEl(document.getElementById(m[1] + dev + m[2]));
        if (v !== undefined) return v;
    }
    const v = readEl(document.getElementById(id));
    return v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? DEFAULTS[id] : v;
}
