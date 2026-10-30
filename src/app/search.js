// Text search: the Search button (right side, under Filter) opens a panel with three text boxes - Song, Artist, Album. A song passes when its name contains what was typed in
// every box that has text (case-insensitive, a plain substring), so filling in two or three boxes narrows the list further. It plays the same role as the Filter button's
// ranges: filter.js ANDs `passes(i)` with its own (setExtra), so Next / Last / shuffle / the gray-out in the graph all follow it. What was typed is remembered (localStorage).
import { cleanTitle } from './title.mjs';

const STORE = 'spxSearch';
const FIELDS = [['n', 'Song'], ['a', 'Artist'], ['al', 'Album']];
const lc = v => (typeof v === 'string' ? v.toLowerCase() : '');

export function createSearch(songs, { onChange }) {
    const q = { n: '', a: '', al: '' };
    try {
        const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (saved && typeof saved === 'object') FIELDS.forEach(([k]) => { if (typeof saved[k] === 'string') q[k] = saved[k]; });
    } catch (e) { /* storage blocked or unreadable */ }
    // lower-cased once; the song name is checked as written AND as shown (remaster / live / year decoration stripped)
    const low = songs.map(s => ({ n: lc(s.n) + '\n' + lc(cleanTitle(s.n || '')), a: lc(s.a), al: lc(s.al) }));
    const needle = k => q[k].trim().toLowerCase();
    const active = () => FIELDS.some(([k]) => needle(k) !== '');
    function passes(i) {
        for (const [k] of FIELDS) { const t = needle(k); if (t && !low[i][k].includes(t)) return false; }
        return true;
    }

    const panel = document.createElement('div');
    panel.className = 'spx-search-panel';
    panel.id = 'spxSearchPanel';
    panel.hidden = true;
    const inputs = {};
    panel.innerHTML = '<div class="spx-srch-head"><span>Search</span><button type="button" class="spx-srch-clear" title="Clear search" aria-label="Clear search">Clear</button></div>';
    FIELDS.forEach(([k, label]) => {
        const row = document.createElement('label');
        row.className = 'spx-srch-row';
        row.innerHTML = '<span class="spx-srch-label"></span>';
        row.firstChild.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'spx-srch-input'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.value = q[k]; inp.setAttribute('aria-label', label);
        inp.addEventListener('input', () => { q[k] = inp.value; commit(); });
        row.appendChild(inp);
        panel.appendChild(row);
        inputs[k] = inp;
    });
    document.body.appendChild(panel);
    function commit() {
        try { localStorage.setItem(STORE, JSON.stringify(q)); } catch (e) { /* storage blocked */ }
        if (onChange) onChange();
    }
    function clear() { FIELDS.forEach(([k]) => { q[k] = ''; inputs[k].value = ''; }); commit(); }
    panel.querySelector('.spx-srch-clear').addEventListener('click', clear);
    let open = false;
    function setOpen(v) { open = !!v; panel.hidden = !open; if (open) setTimeout(() => { if (open) inputs.n.focus(); }, 0); }
    return {
        panel, passes, active, clear, setOpen,
        get open() { return open; },
        describe: () => FIELDS.filter(([k]) => needle(k)).map(([k, l]) => l + ' contains "' + q[k].trim() + '"').join(', '),
    };
}
