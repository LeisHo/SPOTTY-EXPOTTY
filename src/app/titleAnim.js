// Track title button animation. The title is a link to the song on Spotify; when the animation group is
// enabled in the dev panel, hovering and pressing it plays one of six animation styles. State machine:
//   rest  --pointer enters-->  hover  --pointer down-->  press
//   press --release, still over the title-->  hover      press --release elsewhere / pointer left-->  rest
//   hover --pointer leaves-->  rest
// Each style maps the three states to CSS values; transitions are set per state change so e.g. the pulse can
// grow quickly on press and return slowly on release. All numbers come from the dev panel ('Track Title
// Button Animation'); with the group disabled nothing is applied (the title stays plain bold, no underline).
import { setting, rgbaOf } from './settings.js';

const EASINGS = {
    'ease-out': 'ease-out', ease: 'ease', 'ease-in-out': 'ease-in-out', linear: 'linear',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', snap: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
};
const hexToRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [29, 185, 84]; };

// prefix: 'Title' for the track title; 'StartPlay' for the start screen's play icon. Each setting id is the
// 'Title' one with 'Title' replaced by the prefix (e.g. sliderTitlePulseScale -> sliderStartPlayPulseScale).
export function initTitleAnim(link, prefix = 'Title') {
    const S = n => setting(n.replace('Title', prefix));
    let hover = false, down = false, lastState = 'rest';
    const state = () => (down ? 'press' : hover ? 'hover' : 'rest');

    function clear() {
        ['transition', 'transform', 'fontWeight', 'letterSpacing', 'textShadow', 'filter'].forEach(p => { link.style[p] = ''; });
    }

    // The CSS for one state of one mode: { transform, fontWeight, letterSpacing, textShadow, filter, dur? }
    function styleFor(mode, st) {
        const s = {};
        switch (mode) {
            case 'bold':
                s.fontWeight = String(st === 'hover' ? S('sliderTitleBoldHoverWeight') : st === 'press' ? S('sliderTitleBoldPressWeight') : S('sliderTitleBoldRestWeight'));
                break;
            case 'pulse':
                s.transform = st === 'press' ? `scale(${S('sliderTitlePulseScale')})` : 'scale(1)';
                s.dur = st === 'press' ? S('sliderTitlePulseInDuration') : S('sliderTitlePulseOutDuration');
                break;
            case 'grow':
                s.transform = `scale(${st === 'hover' ? S('sliderTitleGrowScale') : st === 'press' ? S('sliderTitleGrowPressScale') : 1})`;
                break;
            case 'glow': {
                const r = st === 'hover' ? S('sliderTitleGlowRadius') : st === 'press' ? S('sliderTitleGlowPressRadius') : 0;
                const [R, G, B] = hexToRgb(S('colorTitleGlowColor'));
                s.textShadow = r > 0 ? `0 0 ${r}px rgba(${R},${G},${B},${S('sliderTitleGlowOpacity')}), 0 0 ${r / 2}px rgba(${R},${G},${B},${S('sliderTitleGlowOpacity')})` : '0 0 0 rgba(0,0,0,0)';
                break;
            }
            case 'tracking':
                s.letterSpacing = `${st === 'hover' ? S('sliderTitleTrackingHover') : st === 'press' ? S('sliderTitleTrackingPress') : 0}em`;
                break;
            case 'lift': {
                const y = st === 'hover' ? -S('sliderTitleLiftPx') : st === 'press' ? S('sliderTitleLiftPressPx') : 0;
                s.transform = `translateY(${y}px)`;
                const blur = S('sliderTitleLiftShadowBlur'), op = S('sliderTitleLiftShadowOpacity');
                const lc = S('colorShadowTitleLift');
                s.filter = !S('checkboxShadowTitleLift') ? 'none' : st === 'hover' ? `drop-shadow(0 ${Math.abs(y) * 0.8}px ${blur}px ${rgbaOf(lc, op)})`
                    : st === 'press' ? `drop-shadow(0 1px ${blur / 3}px ${rgbaOf(lc, op * 0.6)})` : 'drop-shadow(0 0 0 rgba(0,0,0,0))';
                break;
            }
            default: break;
        }
        return s;
    }

    function apply() {
        if (!S('checkboxTitleAnimEnabled')) { clear(); return; }
        const mode = S('selectTitleAnimMode');
        const st = state();
        const s = styleFor(mode, st);
        const dur = s.dur !== undefined ? s.dur : S('sliderTitleAnimDuration');
        const ease = EASINGS[S('selectTitleAnimEasing')] || 'ease-out';
        const props = ['transform', 'font-weight', 'letter-spacing', 'text-shadow', 'filter'];
        link.style.transition = props.map(p => `${p} ${dur}ms ${ease}`).join(', ');
        link.style.transform = s.transform || '';
        link.style.fontWeight = s.fontWeight || '';
        link.style.letterSpacing = s.letterSpacing || '';
        link.style.textShadow = s.textShadow || '';
        link.style.filter = s.filter || '';
        lastState = st;
    }

    link.addEventListener('pointerenter', () => { hover = true; apply(); });
    link.addEventListener('pointerleave', () => { hover = false; apply(); });
    link.addEventListener('pointerdown', e => { if (e.button === 0 || e.pointerType !== 'mouse') { down = true; apply(); } });
    // Release anywhere: back to hover if the pointer is still over the title, otherwise rest.
    const release = () => { if (down) { down = false; apply(); } };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // Re-evaluate whenever any dev-panel setting changes (so the animation previews live), and when the
    // title text changes the element keeps its inline styles because it is the same <a>.
    document.addEventListener('input', apply);
    document.addEventListener('change', apply);
    apply();
    return { refresh: apply, get state() { return lastState; } };
}
