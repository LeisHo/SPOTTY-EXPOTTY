// Strips non-title decoration from a track name: "- 2011 Remaster", "(Live)",
// "[Deluxe Edition]", "(feat. X)", "- Radio Edit", "(Re-Recorded)", "- Single Version",
// "(From The Holdovers)", "- Live at the Harlem Square Club, Miami, FL - January 1963" and so on.
// Only a bracketed group ( ) [ ] { } or a trailing " - " segment is removed, and only when it
// contains one of the words below or a year, so real parentheticals such as
// "(I Can't Get No) Satisfaction" or "(Don't Fear) The Reaper" are left alone. "Pt. 1",
// "Recording 2", "Instrumental" and the like are part of the title and are kept.
// .mjs so it can be unit-checked with plain node.
const KEYWORDS = [
    'remaster(?:ed)?', 're-?master', 'remasteriz\\w*', 'remasteris\\w*', 'live', 'en vivo', 'dal vivo', 'directo', 'concert', 'mono', 'stereo', 'version', 'ver\\.?', 'edit',
    'remix', 'mix', 'demo', 'deluxe', 'bonus', 'anniversary', 'single', 'radio',
    'explicit', 'uncensored', 'clean', 're-?recorded', 'original', 'feat\\.?', 'ft\\.?',
    'featuring', 'soundtrack', 'session', 'sessions', 'jam', 'audition', 'recorded', 'reprise', 'extended',
    'album', 'expanded', 'edition', 'digital', 'restored', 'rework', 'reimagined',
    'studio', 'take', 'alternate', 'alternative', 'outtake', 'rehearsal', 'vocal', 'vocals',
    'colonna sonora', 'motion picture', 'ost', 'o\\.s\\.t\\.?', 'tv series', 'television', 'film', 'movie', 'promo', 'reissue',
];
const KEY_RE = new RegExp('\\b(?:' + KEYWORDS.join('|') + ')\\b', 'i');
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
// "with X" / "from X" only count at the START of a group (a feature or a source), so "(The Whole World Smiles With You)" stays
const START_RE = /^\s*(?:with|from|music from|theme from|score from|as heard (?:in|on)|as seen (?:in|on)|inspired by)\b/i;
const WEB_RE = /\bwww\.|\.(?:com|net|org)\b/i;
const isDecoration = s => KEY_RE.test(s) || YEAR_RE.test(s) || START_RE.test(s) || WEB_RE.test(s);
// a trailing " - segment" can also be a show/film name ("- Main Theme", "- Narcos Theme"): only a dash segment, never a bracketed one
const isDashDecoration = s => isDecoration(s) || /\btheme\b/i.test(s);
const BR = String.raw`[(\[{]([^()\[\]{}]*)[)\]}]`;

export function cleanTitle(name) {
    let t = name.replace(/\s*\[\s*\d+\s*\]/g, ""); // numbers in square brackets ("[1]") are always dropped
    let prev;
    do {
        prev = t;
        // trailing bracketed group: "(...)", "[...]" or "{...}"
        t = t.replace(new RegExp('\\s*' + BR + '\\s*$'), (m, inner) => (isDecoration(inner) ? '' : m));
        // trailing " - segment"
        const i = t.lastIndexOf(' - ');
        if (i > 0 && isDashDecoration(t.slice(i + 3))) t = t.slice(0, i);
        // trailing " feat. X" / " ft. X" / " featuring X" written without brackets
        t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '');
        t = t.trim();
    } while (t !== prev);
    // a bracketed group that isn't last (e.g. "Song (Live) [Remastered]" handled above; this
    // covers "Song (Live) Extra")
    t = t.replace(new RegExp('\\s*' + BR, 'g'), (m, inner) => (isDecoration(inner) ? '' : m)).replace(/\s{2,}/g, ' ').trim();
    return t || name;
}
