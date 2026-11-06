// Builds data-explorer/fun-stats.json: small per-year aggregates (2024-2026) from the
// Extended Streaming History export. Run: node scripts/active/build_fun_stats.js
// Times are UTC (the export's own timestamps). IP addresses are never read into the output.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const dir = path.join(root, 'data', 'Spotify Extended Streaming History');
const YEARS = [2024, 2025, 2026];
const out = { years: {}, generated: new Date().toISOString().slice(0, 10) };

// artists heard before 2024 (to separate "new to you" from "old favourites")
const seenBefore = new Set();
for (const f of fs.readdirSync(dir)) {
  const m = f.match(/^Streaming_History_Audio_(\d{4})/);
  if (!m || +m[1] >= 2024) continue;
  for (const r of JSON.parse(fs.readFileSync(path.join(dir, f)))) {
    if (r.master_metadata_album_artist_name && r.ms_played >= 30000) seenBefore.add(r.master_metadata_album_artist_name);
  }
}
const seenSoFar = new Set(seenBefore);

const top = (map, n) => [...map].sort((a, b) => b[1].ms - a[1].ms).slice(0, n)
  .map(([k, v]) => ({ name: k, plays: v.plays, hours: +(v.ms / 3.6e6).toFixed(1), sub: v.sub }));
const bump = (map, k, ms, sub) => { const v = map.get(k) || { ms: 0, plays: 0, sub }; v.ms += ms; v.plays++; map.set(k, v); };
const count = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

for (const y of YEARS) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, `Streaming_History_Audio_${y}.json`)));
  const S = { rows: rows.length, ms: 0, music: 0, podcast: 0, skips: 0, shuffle: 0, offline: 0, incognito: 0,
    hour: Array(24).fill(0), dow: Array(7).fill(0), month: Array(12).fill(0), days: {}, platform: {}, country: {},
    startReason: {}, endReason: {}, shortPlays: 0, fullPlays: 0 };
  const artists = new Map(), songs = new Map(), shows = new Map(), albums = new Map(), perMonthSong = Array.from({ length: 12 }, () => new Map());
  const daySong = new Map(), newArtists = new Map(), firstSeen = new Map();
  let last = null, run = 0, bestRun = { ms: 0, start: null, end: null }, runStart = null, runMs = 0;
  rows.sort((a, b) => a.ts < b.ts ? -1 : 1);
  for (const r of rows) {
    const d = new Date(r.ts), ms = r.ms_played || 0;
    S.ms += ms;
    S.hour[d.getUTCHours()] += ms; S.dow[d.getUTCDay()] += ms; S.month[d.getUTCMonth()] += ms;
    const day = r.ts.slice(0, 10); S.days[day] = (S.days[day] || 0) + ms;
    count(S.platform, (r.platform || '?').split(' ')[0].toLowerCase().replace(/\(.*/, ''), ms);
    count(S.country, r.conn_country || '?', ms);
    count(S.startReason, r.reason_start || '?'); count(S.endReason, r.reason_end || '?');
    if (r.skipped) S.skips++; if (r.shuffle) S.shuffle++; if (r.offline) S.offline++; if (r.incognito_mode) S.incognito++;
    if (r.master_metadata_track_name) {
      S.music += ms;
      if (ms < 30000) S.shortPlays++; else S.fullPlays++;
      const a = r.master_metadata_album_artist_name || '?', t = r.master_metadata_track_name;
      bump(artists, a, ms); bump(songs, t + ' | ' + a, ms, a); bump(albums, (r.master_metadata_album_album_name || '?') + ' | ' + a, ms);
      bump(perMonthSong[d.getUTCMonth()], t + ' | ' + a, ms);
      bump(daySong, day + '|' + t + ' | ' + a, ms);
      if (!seenSoFar.has(a) && ms >= 30000) { seenSoFar.add(a); firstSeen.set(a, day); }
    } else if (r.episode_name) { S.podcast += ms; bump(shows, r.episode_show_name || '?', ms); }
    // listening binge: gap > 30 min starts a new session
    const t0 = d.getTime();
    if (last !== null && t0 - last > 30 * 60000) {
      if (runMs > bestRun.ms) bestRun = { ms: runMs, start: runStart, end: new Date(last).toISOString() };
      runStart = r.ts; runMs = 0;
    }
    if (runStart === null) runStart = r.ts;
    runMs += ms; last = t0 + ms;
  }
  if (runMs > bestRun.ms) bestRun = { ms: runMs, start: runStart, end: new Date(last).toISOString() };

  // streak of consecutive listening days
  const dayList = Object.keys(S.days).sort(); let streak = 1, bestStreak = { n: 1, end: dayList[0] };
  for (let i = 1; i < dayList.length; i++) {
    const gap = (new Date(dayList[i]) - new Date(dayList[i - 1])) / 864e5;
    streak = gap === 1 ? streak + 1 : 1; if (streak > bestStreak.n) bestStreak = { n: streak, end: dayList[i] };
  }
  const busiest = Object.entries(S.days).sort((a, b) => b[1] - a[1])[0];
  const repeatDay = [...daySong].sort((a, b) => b[1].plays - a[1].plays)[0];
  const rd = repeatDay ? [repeatDay[0].slice(0, 10), repeatDay[0].slice(11)] : null;
  const sorted = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const monthTop = perMonthSong.map(m => { const t = top(m, 1)[0]; return t ? { name: t.name.split(' | ')[0], artist: t.sub, plays: t.plays } : null; });
  const songList = top(songs, 10).map(s => ({ ...s, name: s.name.split(' | ')[0] }));
  const bySongPlays = [...songs].sort((a, b) => b[1].plays - a[1].plays)[0];
  out.years[y] = {
    rows: S.rows, hours: +(S.ms / 3.6e6).toFixed(1), musicHours: +(S.music / 3.6e6).toFixed(1), podcastHours: +(S.podcast / 3.6e6).toFixed(1),
    daysListened: dayList.length, skipPct: +(100 * S.skips / S.rows).toFixed(1), shufflePct: +(100 * S.shuffle / S.rows).toFixed(1),
    offlinePct: +(100 * S.offline / S.rows).toFixed(1), incognito: S.incognito,
    bailedPct: +(100 * S.shortPlays / Math.max(1, S.shortPlays + S.fullPlays)).toFixed(1), shortPlays: S.shortPlays,
    uniqueArtists: artists.size, uniqueSongs: songs.size,
    hourHrs: S.hour.map(v => +(v / 3.6e6).toFixed(1)), dowHrs: S.dow.map(v => +(v / 3.6e6).toFixed(1)), monthHrs: S.month.map(v => +(v / 3.6e6).toFixed(1)),
    topArtists: top(artists, 10), topSongs: songList, topAlbums: top(albums, 5).map(a => ({ ...a, name: a.name.split(' | ')[0] })), topShows: top(shows, 5),
    mostReplayedSong: bySongPlays ? { name: bySongPlays[0].split(' | ')[0], artist: bySongPlays[1].sub, plays: bySongPlays[1].plays } : null,
    busiestDay: busiest ? { day: busiest[0], hours: +(busiest[1] / 3.6e6).toFixed(1) } : null,
    repeatDay: rd ? { day: rd[0], name: rd[1].split(' | ')[0], artist: rd[1].split(' | ')[1], plays: repeatDay[1].plays } : null,
    longestSession: { hours: +(bestRun.ms / 3.6e6).toFixed(1), start: bestRun.start, end: bestRun.end },
    streak: bestStreak, monthTop,
    platforms: sorted(S.platform, 6).map(([k, v]) => ({ name: k, hours: +(v / 3.6e6).toFixed(1) })),
    countries: sorted(S.country, 8).map(([k, v]) => ({ name: k, hours: +(v / 3.6e6).toFixed(1) })),
    startReason: sorted(S.startReason, 6), endReason: sorted(S.endReason, 6),
    newArtists: firstSeen.size, newArtistSample: [...firstSeen].filter(([a]) => artists.get(a)).sort((a, b) => artists.get(b[0]).ms - artists.get(a[0]).ms).slice(0, 5).map(([a, d]) => ({ name: a, first: d, hours: +(artists.get(a).ms / 3.6e6).toFixed(1) })),
  };
}
fs.writeFileSync(path.join(root, 'data-explorer', 'fun-stats.json'), JSON.stringify(out));
console.log('ok', Object.keys(out.years).map(y => y + ':' + out.years[y].rows));
