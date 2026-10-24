// Strips non-title decoration from a track name: "- 2011 Remaster", "(Live)",
// "[Deluxe Edition]", "(feat. X)", "- Radio Edit", "(Re-Recorded)" and so on.
// Only a bracketed group or a trailing " - " segment is removed, and only when it
// contains one of the words below or a year, so real parentheticals such as
// "(I Can't Get No) Satisfaction" or "(Don't Fear) The Reaper" are left alone.
// .mjs so it can be unit-checked with plain node.
const KEYWORDS = [
    'remaster(?:ed)?', 're-?master', 'live', 'mono', 'stereo', 'version', 'ver\\.?', 'edit',
    'remix', 'mix', 'demo', 'acoustic', 'deluxe', 'bonus', 'anniversary', 'single', 'radio',
    'explicit', 'clean', 'instrumental', 're-?recorded', 'original', 'feat\\.?', 'ft\\.?',
    'featuring', 'with', 'from', 'soundtrack', 'session', 'sessions', 'reprise', 'extended',
    'album', 'expanded', 'edition', 'digital', 'restored', 'rework', 'reimagined', 'unplugged',
    'studio', 'take', 'alternate', 'alternative', 'outtake', 'rehearsal',
];
const KEY_RE = new RegExp('\\b(?:' + KEYWORDS.join('|') + ')\\b', 'i');
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const isDecoration = s => KEY_RE.test(s) || YEAR_RE.test(s);

export function cleanTitle(name) {
    let t = name;
    let prev;
    do {
        prev = t;
        // trailing bracketed group: "(...)" or "[...]"
        t = t.replace(/\s*[(\[]([^()\[\]]*)[)\]]\s*$/, (m, inner) => (isDecoration(inner) ? '' : m));
        // trailing " - segment"
        const i = t.lastIndexOf(' - ');
        if (i > 0 && isDecoration(t.slice(i + 3))) t = t.slice(0, i);
        t = t.trim();
    } while (t !== prev);
    // a bracketed group that isn't last (e.g. "Song (Live) [Remastered]" handled above; this
    // covers "Song (Live) Extra")
    t = t.replace(/\s*[(\[]([^()\[\]]*)[)\]]/g, (m, inner) => (isDecoration(inner) ? '' : m)).replace(/\s{2,}/g, ' ').trim();
    return t || name;
}
