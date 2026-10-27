// Reads live values from the dev panel's controls, falling back to defaults when
// the panel isn't built (a normal visitor never builds it). The dev panel owns
// the values; this module never stores a copy -- one source of truth.
//
// Control ids follow the dev panel convention: a Desktop control `sliderFoo` has
// Mobile/Landscape twins `sliderMobileFoo` / `sliderLandscapeFoo`. A twin exists
// only when "Show in Mobile/Landscape" is checked, so fall back to the Desktop id.

export const DEFAULTS = {
    checkboxScrubAudioEnabled: true,
    checkboxPlayPreviewClips: true,
    sliderScrubVolume: 0.7,
    sliderClipStartMin: 2,
    sliderClipStartMax: 22,
    checkboxStartAtBuffer: true,
    sliderClipFadeOut: 30,
    checkboxColdStartClips: true,
    sliderPreloadAhead: 8,
    sliderPreloadBehind: 3,
    checkboxShowPoolOverlay: false,
    sliderTimelineZoomSpeed: 1,
    sliderDefaultTimelineSpanDays: 120,
    checkboxFullScaleOnStartup: false,
    selectUiFont: 'system',
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
    checkboxSpotifyLoginOnStart: true,
    checkboxShowSpotifyPlayer: false,
    checkboxLogPlayback: false,
    checkboxLogPreload: false,
    checkboxExportLogsUiButton: false,
    checkboxShowFrameRate: false,
    colorFrameRateText: '#ffffff',
    sliderFrameRateRefreshMs: 500,
    checkboxSnapshotViewport: true,
    checkboxSnapshotMouse: true,
    checkboxSnapshotPlayback: true,
    sliderHandoffStartOffset: 0,
    checkboxSnapshotAudio: true,
    checkboxSnapshotTimeline: true,
    checkboxSnapshotSettings: true,
    sliderHandoffDelay: 600,
    sliderHandoffCrossfade: 250,
    colorTimelineAccent: '#1db954',
    colorTimelinePlayhead: '#ffffff',
    sliderTimelineBarOpacity: 0.8,
    sliderBarWidth: 3,
    sliderTimelineHeight: 200,
    checkboxTimelineHeightTransition: false,
    sliderTimelineHeightTransitionMs: 300,
    sliderTimelineScaleGap: 0,
    sliderPlayheadWidth: 2,
    sliderPlayheadHeight: 100,
    checkboxRandomStartSong: false,
    checkboxAutoNextSong: false,
    sliderNoPreviewHoldSeconds: 5,
    checkboxLoopPreview: true,
    sliderSpotlightMaxBrightness: 100,
    checkboxVolumeButtonEnabled: true,
    sliderVolMutedOpacity: 40,
    sliderVolIconSize: 24,
    sliderVolCircleRadius: 7,
    sliderVolBarWidth: 8,
    sliderVolBarLength: 130,
    colorVolBarFill: '#1db954',
    colorVolBarTrack: '#ffffff',
    colorVolCircle: '#ffffff',
    sliderVolHoverTolerance: 30,
    sliderVolAnimDuration: 350,
    curveEditorVolAnimSpeedCurve: { points: [{ x: 0, y: 1 }, { x: 1, y: 0.35 }], method: 'monotone' },
    checkboxShadowCover: true,
    checkboxShadowVolume: true,
    checkboxShadowNav: true,
    checkboxShadowFilterPanel: true, colorShadowFilterPanel: '#000000', sliderShadowFilterPanelOpacity: 0.67, sliderShadowFilterPanelBlur: 24, sliderShadowFilterPanelSpread: 0, sliderShadowFilterPanelAngle: 90, sliderShadowFilterPanelDepth: 6,
    checkboxShadowTitleLift: true,
    sliderCoverScale: 1,
    sliderCoverOffsetX: 0,
    sliderCoverOffsetY: 0,
    checkboxCoverBoundingBox: false,
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
    // Shadows (UI Layout > Shadows): colour, opacity, blur, size (cover only), angle (90 = straight down) and depth.
    // Defaults match the shadows the CSS had before these controls existed.
    colorShadowCover: '#000000', sliderShadowCoverOpacity: 0.53, sliderShadowCoverBlur: 28, sliderShadowCoverSpread: 0, sliderShadowCoverAngle: 90, sliderShadowCoverDepth: 8,
    colorShadowVolume: '#000000', sliderShadowVolumeOpacity: 0.67, sliderShadowVolumeBlur: 3, sliderShadowVolumeAngle: 90, sliderShadowVolumeDepth: 1,
    colorShadowNav: '#000000', sliderShadowNavOpacity: 0.67, sliderShadowNavBlur: 3, sliderShadowNavAngle: 90, sliderShadowNavDepth: 1,
    colorShadowTitleLift: '#000000',
    // Startup: the darkening over the app until the first input, and the play icon (no text, no background)
    colorStartOverlay: '#0d0f12', sliderStartOverlayOpacity: 0.8,
    checkboxStartButtonEnabled: true, sliderStartPlaySize: 64, checkboxStartTransitionAfterRelease: false,
    sliderStartFadeMs: 300, checkboxStartCenterOnCover: false,
    sliderPlayheadStartHeight: 0,
    colorTickMark: '#ffffff', sliderTickOpacity: 0.6, sliderTickWidth: 1, sliderTickHeight: 5, sliderTickStartHeight: 0,
    sliderScaleNumbersFontSize: 11, checkboxScaleNumbersBold: false, colorScaleNumbers: '#ffffff', sliderScaleNumbersLetterSpacing: 0, sliderScaleNumbersOpacity: 0.6, sliderScaleNumbersOffsetX: 3,
    checkboxSongAddDateEnabled: true, sliderSongAddDateFontSize: 13, checkboxSongAddDateBold: true, colorSongAddDate: '#ffffff', sliderSongAddDateLetterSpacing: 0, sliderSongAddDateOpacity: 1, sliderSongAddDateOffsetY: 0,
    checkboxShuffleButtonEnabled: true, sliderShuffleIconSize: 20, sliderShuffleIconOffsetX: 0, sliderShuffleOffOpacity: 45, colorShuffleIcon: '#f2f2f2', colorShuffleOn: '#1db954',
    // Start Button Animation: the Track Title Button Animation settings, with 'Title' replaced by 'StartPlay' (see titleAnim.js)
    checkboxStartPlayAnimEnabled: false, selectStartPlayAnimMode: 'bold', sliderStartPlayAnimDuration: 160, selectStartPlayAnimEasing: 'ease-out',
    sliderStartPlayBoldRestWeight: 500, sliderStartPlayBoldHoverWeight: 800, sliderStartPlayBoldPressWeight: 500,
    sliderStartPlayPulseScale: 1.08, sliderStartPlayPulseInDuration: 90, sliderStartPlayPulseOutDuration: 180,
    sliderStartPlayGrowScale: 1.1, sliderStartPlayGrowPressScale: 1,
    sliderStartPlayGlowRadius: 18, sliderStartPlayGlowOpacity: 0.8, colorStartPlayGlowColor: '#1db954', sliderStartPlayGlowPressRadius: 4,
    sliderStartPlayTrackingHover: 0.05, sliderStartPlayTrackingPress: 0,
    sliderStartPlayLiftPx: 6, sliderStartPlayLiftPressPx: 2, sliderStartPlayLiftShadowBlur: 14, sliderStartPlayLiftShadowOpacity: 0.5,
    checkboxShadowStartPlayLift: true, colorShadowStartPlayLift: '#000000',
    checkboxBracketsSmaller: false,
    sliderBracketsFontPct: 60,
    sliderVolIconOffsetX: 0,
    checkboxScaleTitleMultiline: false, sliderTitleMaxLines: 2,
    checkboxScaleArtistMultiline: false, sliderArtistMaxLines: 2,
    checkboxScaleAlbumDateMultiline: false, sliderAlbumDateMaxLines: 2,
    checkboxScaleArtistToMatch: false, checkboxScaleAlbumDateToMatch: false,
    sliderVolIconOpacity: 100, sliderCoverBrightness: 100, sliderVolClickTolerance: 12, selectVolIconStyle: '0', sliderShuffleOnOpacity: 100, selectShuffleIconStyle: '0',
    sliderPlayGlyphOpacityPlaying: 100, sliderPlayGlyphOpacityPaused: 100, selectPlayIconStyle: '0', selectPauseIconStyle: '0', selectNavIconStyle: '0',
    sliderVolHoverOpacity: 100, sliderShuffleOnOpacity: 100,
    sliderNextButtonEdgeOffset: 14, sliderLastButtonEdgeOffset: 14,
    sliderShuffleClickTolerance: 0, sliderShuffleHoverTolerance: 0, sliderNavClickTolerance: 0, sliderNavHoverTolerance: 0, sliderPlayClickTolerance: 0, sliderPlayHoverTolerance: 0,
    checkboxShuffleAnimEnabled: false, sliderShuffleAnimTime: 160, sliderShuffleAnimHoverSize: 24, sliderShuffleAnimClickSize: 18, sliderShuffleAnimReleaseSize: 20,
    sliderShuffleAnimHoverOpacity: 100, sliderShuffleAnimClickOpacity: 100,
    sliderShuffleEdgeOffset: 14, sliderVolEdgeOffset: 14,
    checkboxScrubLineDrag: false, sliderScrubLineAnimTime: 160, sliderScrubLineHoverWidth: 4, sliderScrubLineClickWidth: 6, sliderScrubLineReleaseWidth: 3,
    sliderScrubLineHoverOpacity: 100, sliderScrubLineClickOpacity: 100, sliderPlayheadOpacity: 100,
    checkboxSongBarEnabled: false, sliderSongBarHeight: 4, colorSongBarFill: '#1db954', colorSongBarEmpty: '#3a3f47', sliderSongBarClickTol: 6, sliderSongBarOpacity: 100,
    checkboxSongBarMarker: false, sliderSongBarMarkerRadius: 6, sliderSongBarMarkerOpacity: 100,
    checkboxSongBarAnimEnabled: false, sliderSongBarHoverOpacity: 100, sliderSongBarClickOpacity: 100, sliderSongBarAnimTime: 160,
    checkboxGlobalOverrideEnabled: false, checkboxOverridePlay: false, checkboxOverrideNext: false, checkboxOverrideLast: false, checkboxOverrideShuffle: false, checkboxOverrideFilter: true, checkboxOverrideSongData: true, checkboxOverrideVolume: false,
    colorGlobalOverride: '#ffffff', sliderGlobalOverrideOpacity: 100, sliderGlobalOverrideOnOpacity: 100,
    checkboxGlobalOverrideAnim: false, sliderGlobalAnimTime: 150, sliderGlobalAnimHoverSize: 115, sliderGlobalAnimClickSize: 85, sliderGlobalAnimReleaseSize: 120, sliderGlobalAnimHoverOpacity: 100, sliderGlobalAnimClickOpacity: 70,
    checkboxVolBtnAnimEnabled: false, sliderVolBtnAnimTime: 160, sliderVolBtnAnimHoverSize: 24, sliderVolBtnAnimClickSize: 18, sliderVolBtnAnimReleaseSize: 20,
    sliderVolBtnAnimHoverOpacity: 100, sliderVolBtnAnimClickOpacity: 100,
    textArtistSeparator: ';', // what joins the names when a track has several artists (the data stores them with ';')
    sliderArtistSeparatorPct: 100,
    sliderNavEdgeOffset: 14,
    // Filter button + panel (UI Layout > Audio Buttons > FILTER)
    checkboxFilterButtonEnabled: true, sliderFilterIconSize: 20, sliderFilterIconOffsetX: 0, sliderFilterGapBelowShuffle: 0, sliderFilterEdgeOffset: 14,
    sliderFilterPanelIconSize: 20, sliderFilterPanelIconOffsetY: 0, checkboxFilterPanelKeepVisible: false, sliderFilterPanelRowGap: 12, sliderFilterPanelRowsOffsetY: 0, sliderFilterPanelBlur: 6, sliderFilterOffOpacity: 45, sliderFilterOnOpacity: 100, colorFilterIcon: '#f2f2f2', colorFilterOn: '#1db954',
    sliderFilterClickTolerance: 0, sliderFilterHoverTolerance: 0,
    colorFilterGray: '#8a8f98', sliderFilterGrayOpacity: 35,
    selectFilterMissing: 'hide', checkboxFilterShowNumbers: true, checkboxFilterShowRangeText: false, checkboxFilterShowCount: false, checkboxFilterSkipOnStep: true, checkboxFilterCloseOnOutside: true,
    selectFilterIconStyle: '0', selectSongDataIconStyle: '0', sliderVolIconOffsetY: 0, sliderShuffleIconOffsetY: 0, sliderFilterIconOffsetY: 0, sliderSongDataBtnOffsetY: 0, sliderStartPlayOffsetY: 0, sliderLastButtonOffsetY: 0, sliderNextButtonOffsetY: 0, sliderPlayGlyphOffsetY: 0, selectTempoIconStyle: '0', selectValenceIconStyle: '0', selectDanceIconStyle: '0', selectEnergyIconStyle: '0',
    sliderFilterCoverGrayscale: 100, sliderFilterCoverBrightness: 100, sliderFilterCoverContrast: 100, sliderFilterTextBrightness: 100, sliderFilterCoverTransitionMs: 250, sliderFilterGraphGrayscale: 100,
    checkboxFilterReturnEnabled: true, sliderFilterReturnDelay: 3, sliderFilterReturnDuration: 600, selectFilterReturnEasing: 'ease-in-out', selectFilterReturnRestore: 'end',
    checkboxFilterGrayTicks: true, colorFilterTickGray: '#6b7280', sliderFilterTickGrayOpacity: 25, sliderFilterNumberGrayOpacity: 25,
    sliderFilterPanelWidth: 260, sliderFilterPanelFontSize: 12, sliderFilterPanelOffsetX: 0, sliderFilterPanelOffsetY: 6,
    colorFilterPanelBg: '#14161a', sliderFilterPanelBgOpacity: 92, colorFilterPanelAccent: '#1db954',

    // Song Data button + row, Right Click Pan / Height
    checkboxSongDataEnabled: true, sliderSongDataBtnSize: 20, sliderSongDataBtnOffsetX: 0, sliderSongDataBtnGap: 0, sliderSongDataBtnEdge: 14, sliderSongDataBtnOffOpacity: 45, sliderSongDataBtnOnOpacity: 100, colorSongDataBtn: '#f2f2f2', colorSongDataBtnOn: '#1db954', sliderSongDataClickTolerance: 0, sliderSongDataHoverTolerance: 0, sliderSongDataIconSize: 16, sliderSongDataFontSize: 13, checkboxSongDataBold: true, colorSongData: '#ffffff', sliderSongDataOpacity: 0.9, sliderSongDataIconGap: 5, sliderSongDataItemGap: 14, sliderSongDataFadeMs: 250, sliderSongDataEdgeOffset: 14, sliderSongDataOffsetY: 0, sliderSongDataTempoDecimals: 0, sliderSongDataDecimals: 2,
    checkboxRcPanEnabled: true, sliderRcPanSpeed: 1, checkboxRcPanInvert: false, sliderRcPanThreshold: 0, checkboxRcHeightEnabled: true, sliderRcHeightSpeed: 1, checkboxRcHeightInvert: false, sliderRcHeightThreshold: 12, sliderRcHeightMin: 60, sliderRcHeightMaxPct: 100, sliderRcGraphHeight: 0,

    // Background > Animation (bgAnimation.js)
    selectBgAnimMode: 'none', sliderBgAnimSpeed: 6, sliderBgAnimCenterX: 0, sliderBgAnimCenterY: 0, sliderBgAnimStartStopMs: 2000,
    curveEditorBgAnimStartStop: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], method: 'monotone' },
    sliderBgAnimZoom: 100, sliderBgAnimResolution: 60, sliderBgAnimMaxFps: 60, selectBgAnimBlend: 'normal', sliderBgAnimOpacity: 100,
    sliderBgAnimPatchScale: 500, sliderBgAnimPatchCoverage: 50, sliderBgAnimPatchSoftness: 40, sliderBgAnimPatchDrift: 30, sliderBgAnimPatchOctaves: 3,
    sliderBgAnimBreathPeriod: 8, sliderBgAnimBreathMin: 0, sliderBgAnimBreathMax: 100,
    sliderBgAnimRingWidth: 120, sliderBgAnimRingSpeedStep: 0.5, sliderBgAnimRingEdgeBlur: 0, checkboxBgAnimRingReverse: false, selectBgAnimPatchDriftDir: 'diagonal', selectBgAnimWarpDriftDir: 'diagonal',
    rangeBarBgAnimRingThickness: { min: 120, max: 120 }, curveEditorBgAnimRingThickness: { points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], method: 'monotone' },
    rangeBarBgAnimSwirlStrength: { min: 0, max: 100 }, curveEditorBgAnimSwirlStrength: { points: [{ x: 0, y: 1 }, { x: 0.25, y: 0.65 }, { x: 0.5, y: 0.35 }, { x: 0.75, y: 0.1 }, { x: 1, y: 0 }], method: 'monotone' }, checkboxBgAnimRingAlternate: true,
    sliderBgAnimSwirlRadius: 700, sliderBgAnimSwirlFalloff: 1.5, checkboxBgAnimSwirlInvert: false, sliderBgAnimSwirlTwist: 0,
    sliderBgAnimWarpStrength: 120, sliderBgAnimWarpScale: 420, sliderBgAnimWarpOctaves: 4, sliderBgAnimWarpLacunarity: 2, sliderBgAnimWarpGain: 0.5, sliderBgAnimWarpDrift: 40,

    // Background
    selectBackgroundMode: 'none',
    sliderBackgroundDither: 1, sliderBackgroundOpacity: 1,
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
    sliderBorderRadialGranularity: 180,
    checkboxBorderRadialSmooth: false,
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
    sliderBlurOffsetX: 0,
    sliderBlurOffsetY: 0,
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
    sliderDensityColorBlend: 100,
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
    checkboxAlbumColorTransition: false,
    sliderAlbumColorTransitionMs: 300,
};

// UI Layout > Text: per-text-element battery (Font Size/Color/Bold/Italic/Underline/Letter
// Spacing/Line Spacing/Opacity/Wrap/Max Width/Overflow/Outline/Enabled), ported 2026-10-25 --
// see devPanel.js's buildSpottyTextElementGroup() for the full account. p = the sanitized
// element-name fragment the dev panel ids use ('Song Title' -> 'SongTitle', etc.).
const TEXT_ELEMENT_DEFAULTS = {
    SongTitle: { size: 44, color: '#f2f2f2', bold: true, lineSpacing: 1.1 },
    Artist: { size: 22, color: '#c9d1d9', bold: false, lineSpacing: 1.2 },
    AlbumDate: { size: 14, color: '#8b94a1', bold: false, lineSpacing: 1.2 },
};
Object.entries(TEXT_ELEMENT_DEFAULTS).forEach(([p, d]) => Object.assign(DEFAULTS, {
    ['checkboxTxt' + p + 'Enabled']: true,
    ['sliderTxt' + p + 'FontSize']: d.size,
    ['colorTxt' + p + 'Color']: d.color,
    ['checkboxTxt' + p + 'Bold']: d.bold,
    ['checkboxTxt' + p + 'Italic']: false,
    ['checkboxTxt' + p + 'Underline']: false,
    ['sliderTxt' + p + 'LetterSpacing']: 0,
    ['sliderTxt' + p + 'LineSpacing']: d.lineSpacing,
    ['sliderTxt' + p + 'Opacity']: 1,
    ['sliderTxt' + p + 'OffsetY']: 0,
    ['checkboxTxt' + p + 'WordWrap']: true,
    ['sliderTxt' + p + 'MaxWidth']: 900,
    ['selectTxt' + p + 'Overflow']: 'wrap',
    ['checkboxTxt' + p + 'OutlineEnabled']: false,
    ['colorTxt' + p + 'OutlineColor']: '#000000',
    ['sliderTxt' + p + 'OutlineThickness']: 2,
}));

// UI Layout > Play Button / Next And Last Song Buttons: P = 'Play' or 'Nav'. The same ten settings each (ids built from P in main.js
// applyButtonStyles() and in devPanel.js), plus the Button Animation subgroup's.
const BTN_DEFAULTS = {
    Play: { on: false, color: '#ffffff', size: 56, op: 90, hoverOp: 100, time: 150, hoverSize: 64, clickSize: 48, animHoverOp: 100, animClickOp: 70, releaseSize: 70 },
    Nav: { on: true, color: '#f2f2f2', size: 26, op: 100, hoverOp: 100, time: 150, hoverSize: 30, clickSize: 22, animHoverOp: 100, animClickOp: 70, releaseSize: 32 },
};
Object.entries(BTN_DEFAULTS).forEach(([P, d]) => Object.assign(DEFAULTS, {
    ['checkbox' + P + 'ButtonEnabled']: d.on, ['color' + P + 'Button']: d.color, ['slider' + P + 'ButtonSize']: d.size,
    ['slider' + P + 'ButtonOpacity']: d.op, ['slider' + P + 'ButtonHoverOpacity']: d.hoverOp,
    ['checkbox' + P + 'AnimEnabled']: false, ['slider' + P + 'AnimTime']: d.time, ['slider' + P + 'AnimHoverSize']: d.hoverSize,
    ['slider' + P + 'AnimClickSize']: d.clickSize, ['slider' + P + 'AnimHoverOpacity']: d.animHoverOp,
    ['slider' + P + 'AnimClickOpacity']: d.animClickOp, ['slider' + P + 'AnimReleaseSize']: d.releaseSize,
}));

// '#rrggbb' + alpha -> 'rgba(r,g,b,a)' for the shadow CSS (black if the hex does not parse)
export function rgbaOf(hex, a) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    const [r, g, b] = m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [0, 0, 0];
    return `rgba(${r},${g},${b},${a})`;
}

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

// ---- saved settings for visitors who have no dev panel -------------------------------------------------------------------
// The dev panel's Sync saves every control's value to GitHub (data/processed/dev-panel-settings.json, read through
// /api/save-settings). A normal visitor never builds the panel, so setting() found no control and returned the code DEFAULTS:
// none of the saved settings applied outside dev mode. loadSavedSettings() (called once at boot when the panel will not be
// built) fetches that saved state, and setting() falls back to it before the defaults. A built panel's live controls still win.
let savedState = null;
async function gunzipBase64(b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}
export async function loadSavedSettings(timeoutMs = 4000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        let state = null;
        try { // the live copy (GitHub, through the Vercel function); not there on the local server
            const r = await fetch('/api/save-settings', { signal: ctl.signal, cache: 'no-store' });
            const b = await r.json();
            if (b && b.ok) state = b.gz ? JSON.parse(await gunzipBase64(b.gz)) : b.settings;
        } catch (e) { /* fall through to the static copy */ }
        if (!state) { // the copy committed with the last deployment
            const r = await fetch('data/processed/dev-panel-settings.json', { signal: ctl.signal, cache: 'no-store' });
            if (r.ok) state = await r.json();
        }
        savedState = state && state.controls ? state : null;
        return savedState;
    } catch (e) {
        return null;
    } finally { clearTimeout(timer); }
}
const coerceSaved = (id, v) => {
    if (/^(rangeBar|curveEditor)/.test(id)) { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return undefined; } } return v; }
    if (/^slider/.test(id) && typeof v === 'string') { const n = parseFloat(v); return Number.isNaN(n) ? undefined : n; }
    return v;
};
function savedValue(id) {
    if (!savedState) return undefined;
    const dev = activeDevice();
    if (dev) { // a Mobile / Landscape value that was saved as independent from Desktop
        const key = dev === 'Mobile' ? 'mobile' : 'landscape';
        const ind = savedState.devIndependence && savedState.devIndependence[key], vals = savedState.devDeviceValues && savedState.devDeviceValues[key];
        if (ind && ind[id] && vals && vals[id] !== undefined) return coerceSaved(id, vals[id]);
    }
    const v = savedState.controls[id];
    return v === undefined ? undefined : coerceSaved(id, v);
}

export function setting(id) {
    const m = id.match(/^(slider|color|select|checkbox|rangeBar|curveEditor)(.+)$/);
    const dev = activeDevice();
    if (dev && m) {
        const v = readEl(document.getElementById(m[1] + dev + m[2]));
        if (v !== undefined) return v;
    }
    const v = readEl(document.getElementById(id));
    if (v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) return v;
    const sv = savedValue(id);
    return sv !== undefined ? sv : DEFAULTS[id];
}
