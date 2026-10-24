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
    sliderTouchScrubSpeed: 1,
    sliderTouchScrubAcceleration: 0,
    sliderTouchStartThreshold: 4,
    checkboxInvertTouchScrub: false,
    sliderPinchZoomSpeed: 1,
    checkboxInvertPinch: false,
    checkboxHandoffEnabled: true,
    sliderHandoffDelay: 600,
    colorTimelineAccent: '#1db954',
    colorTimelinePlayhead: '#ffffff',
    sliderTimelineBarOpacity: 0.8,
    sliderBarWidth: 3,
    sliderTimelineHeight: 200,
    rangeBarTimelineZoomLimits: { min: 0, max: 100 }, // % on a log scale: 0 = 2 min visible, 100 = whole timeline

    // Wheel scrub per notch curve (X: zoom scale, Y: px per notch between Min and Max)
    checkboxWheelCurveEnabled: false,
    curveEditorWheelScrubCurve: { points: [{ x: 0, y: 0.2 }, { x: 1, y: 0.7 }], method: 'monotone' },
    selectWheelCurveXRange: 'limits',
    sliderWheelCurveMinPx: 4,
    sliderWheelCurveMaxPx: 160,
    // Starting timeline span curve (X: playhead position along the timeline, Y: span between Min and Max days, log scale)
    checkboxStartSpanCurveEnabled: false,
    curveEditorStartSpanCurve: { points: [{ x: 0, y: 0.55 }, { x: 1, y: 0.55 }], method: 'monotone' },
    sliderStartSpanCurveMinDays: 7,
    sliderStartSpanCurveMaxDays: 1200,
    checkboxStartSpanApplyOnJump: true,

    // Track title button animation
    checkboxTitleAnimEnabled: false,
    selectTitleAnimMode: 'bold',
    sliderTitleAnimDuration: 160,
    selectTitleAnimEasing: 'ease-out',
    sliderTitleBoldRestWeight: 500,
    sliderTitleBoldHoverWeight: 800,
    sliderTitleBoldPressWeight: 500,
    sliderTitlePulseScale: 1.08,
    sliderTitlePulseInDuration: 90,
    sliderTitlePulseOutDuration: 180,
    sliderTitleGrowScale: 1.1,
    sliderTitleGrowPressScale: 1,
    sliderTitleGlowRadius: 18,
    sliderTitleGlowOpacity: 0.8,
    colorTitleGlowColor: '#1db954',
    sliderTitleGlowPressRadius: 4,
    sliderTitleTrackingHover: 0.05,
    sliderTitleTrackingPress: 0,
    sliderTitleLiftPx: 6,
    sliderTitleLiftPressPx: 2,
    sliderTitleLiftShadowBlur: 14,
    sliderTitleLiftShadowOpacity: 0.5,

    // Background
    selectBackgroundMode: 'none',
    sliderBackgroundOpacity: 1,
    sliderBackgroundBrightness: 1,
    sliderBackgroundSaturation: 1,
    sliderBackgroundTransition: 400,
    colorBackgroundColor: '#0d0f12',
    curveEditorBackgroundGradient: { stops: [{ p: 0, c: '#1db954' }, { p: 1, c: '#0d0f12' }] },
    selectBackgroundGradientType: 'linear',
    sliderBackgroundGradientRotation: 135,
    sliderBackgroundGradientScale: 1,
    sliderBackgroundGradientCenterX: 50,
    sliderBackgroundGradientCenterY: 50,
    sliderBorderDepth: 8,
    sliderBorderRadialRays: 180,
    sliderBorderRadialSmoothing: 4,
    sliderBorderRadialStart: 100,
    sliderBorderRadialFade: 0,
    colorBorderRadialFadeColor: '#0d0f12',
    selectBorderAverageEdges: 'all',
    sliderChromaMinSaturation: 0.2,
    sliderChromaMinBrightness: 0.12,
    sliderChromaGrayscaleThreshold: 85,
    sliderBlurRadius: 60,
    sliderBlurScale: 1.6,
    sliderBlurDarken: 0.45,
    selectPaletteGradientType: 'linear',
    sliderPaletteRotation: 160,
    sliderPaletteScale: 1,
    selectSpotlightColorSource: 'vivid',
    sliderSpotlightRadius: 70,
    sliderSpotlightIntensity: 0.9,
    checkboxSpotlightFollowCover: true,
    sliderSpotlightCenterX: 50,
    sliderSpotlightCenterY: 40,
    colorSpotlightEdgeColor: '#0d0f12',
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
    if (el.id && /^(rangeBar|curveEditor)/.test(el.id)) { // hidden input holding JSON: {min,max}, a curve's {points,method}, or a gradient's {stops}
        try { return JSON.parse(el.value); } catch (e) { return undefined; }
    }
    return el.value;
}

export function setting(id) {
    const m = id.match(/^(slider|color|select|checkbox|rangeBar|curveEditor)(.+)$/);
    const dev = activeDevice();
    if (dev && m) {
        const v = readEl(document.getElementById(m[1] + dev + m[2]));
        if (v !== undefined) return v;
    }
    const v = readEl(document.getElementById(id));
    return v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? DEFAULTS[id] : v;
}
