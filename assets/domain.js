export const STATUS = { open: 'Offen', active: 'In Arbeit', passed: 'Bestanden', failed: 'Nicht bestanden' };
export const KINDS = { exam: 'Prüfung', submission: 'Abgabe', presentation: 'Präsentation', lab: 'Labor', registration: 'Anmeldung', deadline: 'Frist', personal: 'Persönlich' };
export const WIDGETS = { progress: 'Studienfortschritt', exams: 'Nächste Termine', tasks: 'Offene Aufgaben', note: 'Persönliche Notiz' };
export const id = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const emptyState = () => ({ profiles: [], modules: [], events: [], tasks: [], settings: { activeProfile: '', widgets: Object.keys(WIDGETS), note: '', compact: false, motion: true, theme: 'light' } });
export const fmt = value => value == null ? 'Offen' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);
export const date = (value, options = {}) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', ...options }).format(new Date(value));
export const dayKey = (day = new Date()) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
export const localInput = (day = new Date()) => `${dayKey(day)}T${String(day.getHours()).padStart(2, '0')}:${String(day.getMinutes()).padStart(2, '0')}`;
export function summary(state, profileId) {
  const modules = state.modules.filter(m => m.profileId === profileId), passed = modules.filter(m => m.status === 'passed');
  const graded = passed.filter(m => m.grade != null && m.ects > 0), weight = graded.reduce((n, m) => n + m.ects, 0);
  return { ects: passed.reduce((n, m) => n + m.ects, 0), passed: passed.length, active: modules.filter(m => m.status === 'active').length, failed: modules.filter(m => m.status === 'failed').length,
    average: weight ? Math.round(graded.reduce((n, m) => n + m.grade * m.ects, 0) / weight * 100) / 100 : null };
}
export function removeModule(state, moduleId) {
  state.modules = state.modules.filter(m => m.id !== moduleId);
  state.modules.forEach(m => { m.prerequisites = m.prerequisites.filter(ref => ref !== moduleId); });
  state.events.forEach(e => { if (e.moduleId === moduleId) e.moduleId = ''; });
}
export function removeProfile(state, profileId) {
  state.profiles = state.profiles.filter(p => p.id !== profileId);
  for (const key of ['modules', 'events', 'tasks']) state[key] = state[key].filter(row => row.profileId !== profileId);
  if (state.settings.activeProfile === profileId) state.settings.activeProfile = state.profiles[0]?.id || '';
}
export const unmet = (state, module) => module.prerequisites.map(ref => state.modules.find(m => m.id === ref)).filter(m => m && m.status !== 'passed');
// Explicit IANA-zone wall time; the earlier instant is used in an autumn fold.
export function eventInstant(event) {
  const [year, month, day, hour, minute] = event.start.split(/[-T:]/).map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(target);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day || hour > 23 || minute > 59) return NaN;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
    const correction = target - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    if (!correction) {
      let first = guess;
      for (const delta of [1800000, 3600000, 5400000, 7200000, 9000000, 10800000]) {
        if (formatter.format(new Date(guess - delta)) === formatter.format(new Date(guess))) first = guess - delta;
      }
      return first;
    }
    guess += correction;
  }
  return NaN;
}
export function calendar(events, modules) {
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r/g, '').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moduly//Study Calendar 1.0//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of events) {
    const start = eventInstant(event);
    if (!Number.isFinite(start)) throw new Error('Ungültige Uhrzeit bei Zeitumstellung. Bitte Termin prüfen.');
    const module = modules.find(m => m.id === event.moduleId);
    lines.push('BEGIN:VEVENT', `UID:${event.id}@moduly`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + event.duration * 60000)}`,
      `SUMMARY:${escape(event.title)}`, `LOCATION:${escape(event.location)}`, `DESCRIPTION:${escape([module?.name, event.notes, 'Persönlicher Termin. Bei Änderungen die Kalenderkopie aktualisieren.'].filter(Boolean).join('\n'))}`);
    for (const alarm of ['-P7D', '-P1D']) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(event.title)}`, `TRIGGER:${alarm}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const encoder = new TextEncoder();
  return lines.map(line => {
    let out = '', part = '';
    for (const char of line) { if (encoder.encode(part + char).length > 75) { out += part + '\r\n'; part = ' '; } part += char; }
    return out + part;
  }).join('\r\n') + '\r\n';
}
export function validateClient(input) {
  // Device-preview/import checks. The server performs authoritative canonical validation.
  const fail = message => { throw new Error(message); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Kein Moduly-Studienplan erkannt.');
  const data = clone(input), limits = { profiles: 12, modules: 1000, events: 2000, tasks: 2000 };
  const goodId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  for (const [key, limit] of Object.entries(limits)) {
    if (!Array.isArray(data[key]) || data[key].length > limit) fail(`Ungültige Liste: ${key}.`);
    const ids = new Set();
    for (const row of data[key]) {
      if (!row || !goodId(row.id) || ids.has(row.id)) fail('Ungültige oder doppelte Kennungen.');
      ids.add(row.id);
      if (key !== 'profiles' && !data.profiles.some(p => p.id === row.profileId)) fail('Ein Studienprofil fehlt.');
    }
  }
  const str = (value, max, required = false) => { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('Ein Textfeld fehlt oder ist zu lang.'); };
  const num = (value, min, max, integer = false) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail('Eine Zahl liegt außerhalb des erlaubten Bereichs.'); };
  const source = value => { str(value, 1000); if (value) { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('Ungültiger Quellenlink.'); } };
  for (const p of data.profiles) {
    str(p.name, 150, true); str(p.university, 150); str(p.degree, 80); str(p.po, 80); source(p.source);
    num(p.targetEcts, 1, 1000); num(p.semesters, 1, 20, true); num(p.currentSemester, 1, 30, true); num(p.thesisEcts, 0, 1000);
  }
  for (const m of data.modules) {
    str(m.name, 150, true); str(m.code, 60); str(m.notes, 10000); str(m.materials, 2000); str(m.examType, 80); str(m.sourceDate, 30); source(m.source);
    num(m.ects, 0, 60); num(m.semester, 1, 30, true); num(m.attempts, 0, 20, true); num(m.duration, 0, 600, true);
    if (!Object.hasOwn(STATUS, m.status)) fail('Ungültiger Modulstatus.');
    if (m.grade != null) num(m.grade, 1, 5);
    if (m.status === 'passed' && m.grade > 4) fail('Eine Note über 4,0 gilt nicht als bestanden.');
    if (m.status === 'failed' && m.grade != null && m.grade <= 4) fail('Note und Status widersprechen sich.');
    if (!Array.isArray(m.prerequisites) || m.prerequisites.length > 50 || m.prerequisites.some(ref => ref === m.id || !data.modules.some(other => other.id === ref && other.profileId === m.profileId))) fail('Ungültige Modulvoraussetzungen.');
    if (!Array.isArray(m.components) || m.components.length > 20) fail('Ungültige Prüfungsbestandteile.');
    const ids = new Set();
    for (const c of m.components) {
      if (!goodId(c.id) || ids.has(c.id)) fail('Ungültige Prüfungsbestandteile.');
      ids.add(c.id); str(c.name, 150, true); num(c.weight, 0, 100); if (c.grade != null) num(c.grade, 1, 5);
      if (m.status === 'passed' && c.required && !c.passed) fail('Ein erforderlicher Prüfungsbestandteil ist noch offen.');
    }
    if (m.components.reduce((n, c) => n + c.weight, 0) > 100.001) fail('Gewichtung der Bestandteile ist größer als 100 %.');
    m.edited = true;
  }
  const remaining = new Map(data.modules.map(m => [m.id, new Set(m.prerequisites)]));
  while (remaining.size) {
    const ready = [...remaining].filter(([, deps]) => !deps.size).map(([key]) => key);
    if (!ready.length) fail('Voraussetzungen dürfen keinen Kreis bilden.');
    for (const key of ready) { remaining.delete(key); remaining.forEach(deps => deps.delete(key)); }
  }
  for (const e of data.events) {
    str(e.title, 150, true); str(e.location, 300); str(e.notes, 4000); str(e.timezone, 60, true);
    if (!Object.hasOwn(KINDS, e.kind) || !/^(20\d\d|2100)-\d\d-\d\dT\d\d:\d\d$/.test(e.start) || !Number.isFinite(eventInstant(e))) fail('Ungültiges Datum oder Zeitumstellung.');
    num(e.duration, 1, 1440, true);
    if (e.moduleId && !data.modules.some(m => m.id === e.moduleId && m.profileId === e.profileId)) fail('Das verknüpfte Modul fehlt.');
  }
  for (const t of data.tasks) { str(t.title, 300, true); str(t.notes, 4000); str(t.due, 10); if (t.due && (!/^\d{4}-\d{2}-\d{2}$/.test(t.due) || Number.isNaN(Date.parse(t.due)) || new Date(t.due).toISOString().slice(0, 10) !== t.due)) fail('Ungültiges Aufgabendatum.'); num(t.minutes, 0, 10000, true); }
  const s = data.settings;
  if (!s || typeof s !== 'object' || !Array.isArray(s.widgets) || s.widgets.length > 4 || s.widgets.some(w => !Object.hasOwn(WIDGETS, w)) || !['light', 'dark'].includes(s.theme)) fail('Ungültige Einstellungen.');
  str(s.note, 10000);
  if (s.activeProfile && !data.profiles.some(p => p.id === s.activeProfile)) fail('Aktives Studienprofil fehlt.');
  return data;
}
export function demoState() {
  const data = emptyState(), profileId = id();
  data.profiles.push({ id: profileId, name: 'Mein Beispielstudium', university: 'Frei angelegtes Beispiel', degree: 'Bachelor', po: '', targetEcts: 180, semesters: 6, currentSemester: 2, thesisEcts: 0, archived: false, source: '' });
  ['Mathematik', 'Wissenschaftliches Arbeiten', 'Grundlagen der Informatik', 'Projektarbeit'].forEach((name, i) => data.modules.push({ id: id(), profileId, name, code: '', ects: i === 3 ? 10 : 5, semester: i < 2 ? 1 : 2, status: i < 2 ? 'passed' : 'active', grade: i < 2 ? (i ? 1.7 : 2.3) : null, attempts: i < 2 ? 1 : 0, examType: 'Klausur', duration: 90, materials: '', notes: '', source: '', sourceDate: '', prerequisites: [], components: [], thesisRequired: false, edited: true }));
  const next = new Date(); next.setDate(next.getDate() + 9); next.setHours(9, 0, 0, 0);
  data.events.push({ id: id(), profileId, moduleId: data.modules[2].id, title: 'Informatik: Beispielprüfung', start: localInput(next), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin', duration: 90, kind: 'exam', location: 'Beispielraum', notes: '' });
  data.tasks.push({ id: id(), profileId, title: 'Die ersten Lernkarten erstellen', due: dayKey(next), done: false, minutes: 45, notes: '' });
  data.settings.activeProfile = profileId;
  return data;
}
