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
    sliderTimelineZoomSpeed: 1,
    sliderDefaultTimelineSpanDays: 120,
    sliderTitleScale: 1,
    sliderArtistScale: 1,
    sliderMetaScale: 1,
    checkboxInvertScroll: false,
    checkboxInvertZoomDrag: false,
    sliderWheelScrubPixels: 40,
    checkboxHandoffEnabled: true,
    sliderHandoffDelay: 600,
    colorTimelineAccent: '#1db954',
    colorTimelinePlayhead: '#ffffff',
    sliderTimelineBarOpacity: 0.8,
    sliderBarWidth: 3,
    sliderTimelineHeight: 200,
    rangeBarTimelineZoomLimits: { min: 0, max: 100 }, // % on a log scale: 0 = 2 min visible, 100 = whole timeline
    selectTimelineStyle: 'none',
    sliderGlowStemWidth: 2,
    sliderGlowRadius: 12,
    sliderGlowDotSize: 4,
    sliderGlowIntensity: 0.8,
    sliderDensitySmoothing: 14,
    sliderDensityFillOpacity: 0.55,
    sliderDensityOutlineWidth: 2,
    checkboxDensityGradientFill: true,
    selectLineFeature: 'valence',
    sliderLineWidth: 2,
    sliderLineDotSize: 3,
    sliderLineFillOpacity: 0.2,
    checkboxLineSmooth: true,
    selectRibbonFeature: 'valence',
    sliderRibbonThickness: 28,
    sliderRibbonSmoothing: 24,
    sliderRibbonBarsOpacity: 0.25,
    checkboxAlbumColorsEnabled: false,
    selectAlbumColorMode: 'stacked',
    sliderAlbumColorSaturation: 1,
    sliderAlbumColorBrightness: 1,
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
    if (el.id && el.id.startsWith('rangeBar')) { // dual-handle range control: hidden input holding {min,max} JSON
        try { return JSON.parse(el.value); } catch (e) { return undefined; }
    }
    return el.value;
}

export function setting(id) {
    const m = id.match(/^(slider|color|select|checkbox|rangeBar)(.+)$/);
    const dev = activeDevice();
    if (dev && m) {
        const v = readEl(document.getElementById(m[1] + dev + m[2]));
        if (v !== undefined) return v;
    }
    const v = readEl(document.getElementById(id));
    return v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? DEFAULTS[id] : v;
}
