import { Store, ApiError } from './api.js';
import { STATUS, KINDS, WIDGETS, id, clone, emptyState, fmt, date, dayKey, localInput, summary, removeModule, removeProfile, unmet, eventInstant, calendar, validateClient, demoState } from './domain.js';

const $ = selector => document.querySelector(selector);
const store = new Store();
let state = emptyState(), page = 'overview', busy = false, actionLock = false, submitting = false, authMode = 'login', month = new Date(), filter = '', query = '', semester = '', showPast = false;
let dialogSave = null, closeGuard = false, toastTimer, focusBeforeDialog, currentComponents = [], widgetOrder = [], adminData = null;
const titles = { overview: 'Übersicht', study: 'Studium', exams: 'Prüfungen & Fristen', calendar: 'Kalender', planning: 'Lernplanung', export: 'Export', settings: 'Einstellungen', admin: 'Verwaltung' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (label, action, value = '', cls = 'quiet-button pressable') => `<button type="button" class="${cls}" data-action="${action}" data-id="${escape(value)}">${label}</button>`;
const primary = (label, action, value = '') => button(`<span>${label}</span><span class="button-arrow" aria-hidden="true">↗</span>`, action, value, 'button-primary pressable');
const profile = () => state.profiles.find(p => p.id === state.settings.activeProfile) || state.profiles[0];
const items = key => state[key].filter(row => row.profileId === profile()?.id);
const sortedEvents = () => items('events').sort((a, b) => eventInstant(a) - eventInstant(b));
const heading = (title, copy, actions = '') => `<div class="page-heading"><div><h1>${escape(title)}</h1><p class="heading-copy">${escape(copy)}</p></div><div class="heading-actions">${actions}</div></div>`;
const empty = (title, copy, action = '') => `<div class="empty-state"><h3>${escape(title)}</h3><p>${escape(copy)}</p>${action}</div>`;
const field = (label, name, value = '', type = 'text', attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escape(value)}" ${attrs}></label>`;
const area = (label, name, value = '', max = 4000) => `<label class="field span-2"><span>${label}</span><textarea name="${name}" rows="3" maxlength="${max}">${escape(value)}</textarea></label>`;
const select = (label, name, choices, value = '') => `<label class="field"><span>${label}</span><select name="${name}">${Object.entries(choices).map(([key, text]) => `<option value="${escape(key)}" ${key === String(value) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
const check = (label, name, checked = false, value = 'on') => `<label class="check-row"><input type="checkbox" name="${name}" value="${escape(value)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
const link = (url, label) => /^https?:\/\//i.test(url || '') ? `<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>` : '<span class="muted">Quelle offen</span>';
const statusPill = m => `<span class="status-pill ${m.status}">${m.status === 'passed' ? '✓ ' : ''}${STATUS[m.status]}</span>`;
const val = (form, name) => new FormData(form).get(name)?.trim() || '';
const num = (form, name) => Number(val(form, name));
const checked = (form, name) => new FormData(form).has(name);

function toast(message, error = false) {
  const element = $('#toast'); element.textContent = message; element.classList.toggle('is-error', error); element.classList.add('is-visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('is-visible'), error ? 9000 : 4500);
}
function showError(error, target) {
  if (target) { target.textContent = error.message || 'Etwas ist fehlgeschlagen.'; target.hidden = false; target.focus(); }
  else toast(error.message || 'Etwas ist fehlgeschlagen.', true);
  if (error.status === 409) $('#save-status').textContent = 'Versionskonflikt. Bitte neu laden.';
  if (error.status === 401 && store.user) toast('Deine Sitzung ist abgelaufen. Eingaben sichern und neu anmelden.', true);
}
async function mutate(change, message = 'Gespeichert') {
  if (busy) throw new Error('Ein Speichervorgang läuft noch.');
  busy = true; $('#save-status').textContent = 'Speichert …';
  try { const next = clone(state); change(next); state = await store.save(next); render(); toast(message); }
  finally { busy = false; $('#save-status').textContent = 'Version ' + store.revision; }
}
function openDialog(title, content, onSave = null, submitText = 'Speichern', guarded = false) {
  const dialog = $('#editor'); focusBeforeDialog = document.activeElement; dialogSave = onSave; closeGuard = guarded;
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = onSave ? `<form id="editor-form"><div class="form-grid">${content}</div><p class="form-error" role="alert" tabindex="-1" hidden></p><div class="modal-actions">${button('Abbrechen', 'close-dialog')}<button class="button-primary pressable" type="submit">${submitText}<span class="button-arrow" aria-hidden="true">↗</span></button></div></form>` : content;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  if (busy || closeGuard) return;
  $('#editor').close(); clearDialog(); focusBeforeDialog?.focus();
}
function clearDialog() {
  if ($('#editor').open) return;
  $('#dialog-content').replaceChildren(); dialogSave = null; currentComponents = [];
}
function confirmation(title, copy, callback, label = 'Bestätigen') {
  openDialog(title, `<p class="span-2">${escape(copy)}</p>${check('Ich habe den Hinweis gelesen.', 'confirm')}`, async form => {
    if (!checked(form, 'confirm')) throw new Error('Bitte den Hinweis bestätigen.');
    await callback();
  }, label);
}
function recoveryDialog(code) {
  openDialog('Dein Wiederherstellungscode', `<p class="span-2">Speichere den Code außerhalb von Moduly. Ohne Passwort und Code können wir dein Konto nicht wiederherstellen. Er wird nur jetzt angezeigt.</p><code class="recovery-code span-2">${escape(code)}</code><div class="span-2">${button('Code als Datei sichern', 'download-recovery', code)}</div>${check('Ich habe meinen Code sicher aufbewahrt.', 'saved')}`, async form => {
    if (!checked(form, 'saved')) throw new Error('Bitte sichere zuerst deinen Wiederherstellungscode.');
    closeGuard = false;
  }, 'Weiter zu meinem Studium', true);
}
function showAuth(mode = 'login') {
  authMode = mode; $('#welcome').hidden = false; $('#app').hidden = true;
  $('#main-content').replaceChildren(); $('#profile-switch').replaceChildren();
  $('#username').textContent = ''; $('#profile-meta').textContent = '';
  closeMenu();
  if (store.mode === 'preview') {
    $('#auth-content').innerHTML = `<h2>Schau dich um.</h2><p>Probiere den Studienplan direkt auf deinem Gerät aus. In dieser Vorschau bleiben deine Einträge in diesem Browser.</p><p>Für persönliche Konten auf mehreren Geräten wird Moduly auf deinem eigenen Server betrieben.</p><div class="auth-buttons">${primary('Vorschau öffnen', 'preview')}${button('Mit Beispielen starten', 'demo')}${button('Vorschau zurücksetzen', 'reset-preview', '', 'text-button')}</div><p class="small muted">Die Beispieldaten gehören zu keiner realen Prüfungsordnung.</p>`;
    return;
  }
  const register = mode === 'register', recover = mode === 'recover';
  $('#auth-content').innerHTML = `<h2>${register ? 'Dein Konto beginnt hier.' : recover ? 'Zurück in deinen Plan.' : 'Schön, dass du da bist.'}</h2><p>${register ? 'Ein eindeutiger Benutzername und ein Passwort genügen. Du bekommst einen Wiederherstellungscode.' : recover ? 'Mit deinem einmaligen Wiederherstellungscode kannst du ein neues Passwort vergeben.' : 'Melde dich an und mach dort weiter, wo du aufgehört hast.'}</p><form id="auth-form" class="auth-form">${field('Benutzername', 'username', '', 'text', 'required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false"')}${recover ? field('Wiederherstellungscode', 'recoveryCode', '', 'text', 'required maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false"') : ''}${field(recover ? 'Neues Passwort' : 'Passwort', recover ? 'newPassword' : 'password', '', 'password', `required ${register || recover ? 'minlength="12"' : ''} maxlength="128" autocomplete="${register || recover ? 'new-password' : 'current-password'}"`)}${register || recover ? field('Passwort wiederholen', 'repeat', '', 'password', 'required minlength="12" maxlength="128" autocomplete="new-password"') : ''}${register && store.meta.inviteRequired ? field('Einladungscode', 'invite', '', 'text', 'required autocomplete="off"') : ''}${register ? '<p class="small">Mindestens 12 Zeichen. Deine privaten Einträge sind nur in deinem Konto sichtbar.</p>' : ''}<p class="form-error" role="alert" tabindex="-1" hidden></p><button class="button-primary pressable" type="submit"><span>${register ? 'Konto erstellen' : recover ? 'Passwort zurücksetzen' : 'Anmelden'}</span><span class="button-arrow" aria-hidden="true">↗</span></button></form><div class="auth-alternatives">${mode !== 'login' ? button('Ich habe bereits ein Konto', 'auth-mode', 'login', 'text-button') : `${store.meta.registration ? button('Ein Konto erstellen', 'auth-mode', 'register', 'text-button') : '<span>Die Registrierung ist derzeit geschlossen.</span>'}${button('Passwort vergessen?', 'auth-mode', 'recover', 'text-button')}`}</div>`;
}
async function enter() {
  state = await store.load(); $('#welcome').hidden = true; $('#app').hidden = false;
  $('#preview-notice').hidden = store.mode !== 'preview';
  $('#username').textContent = store.user?.username || 'Deine Vorschau';
  $('#user-avatar').textContent = (store.user?.username || 'M').slice(0, 2).toUpperCase();
  $('#storage-label').textContent = store.mode === 'server' ? 'Privates Konto' : 'Auf diesem Gerät';
  $('#admin-nav').hidden = !['admin', 'owner'].includes(store.user?.role);
  const initial = location.hash.slice(1); page = Object.hasOwn(titles, initial) && initial !== 'admin' ? initial : 'overview';
  render();
}
function navigate(target) {
  if (!Object.hasOwn(titles, target)) return;
  page = target; query = ''; filter = ''; semester = ''; history.replaceState(null, '', '#' + page); closeMenu(); render(); $('#main-content').focus();
}
function syncMenu() {
  const mobile = matchMedia('(max-width: 820px)').matches, opened = document.body.classList.contains('sidebar-open');
  $('#sidebar').inert = mobile && !opened;
  $('.workspace').inert = mobile && opened;
}
function closeMenu() { document.body.classList.remove('sidebar-open'); $('[data-action="open-menu"]').setAttribute('aria-expanded', 'false'); syncMenu(); }
function render() {
  const p = profile();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.motion ? 'on' : 'off';
  document.body.classList.toggle('is-compact', state.settings.compact);
  $('#profile-switch').innerHTML = state.profiles.length ? state.profiles.map(item => `<option value="${escape(item.id)}" ${item.id === p?.id ? 'selected' : ''}>${escape(item.name)}${item.archived ? ' (archiviert)' : ''}</option>`).join('') : '<option value="">Noch kein Studienprofil</option>';
  $('#profile-meta').textContent = p ? `${p.degree || 'Dein Studium'} · Semester ${p.currentSemester}` : 'Dein persönlicher Bereich';
  $('#page-name').textContent = titles[page];
  document.title = `${titles[page]} · Moduly`;
  document.querySelectorAll('.nav-item').forEach(element => { element.classList.toggle('is-active', element.dataset.page === page); if (element.dataset.page === page) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current'); });
  $('#main-content').innerHTML = `<section class="page is-active">${p?.archived ? '<div class="archive-notice">Dieses Studienprofil ist archiviert. Deine Daten bleiben erhalten und können weiter bearbeitet werden.</div>' : ''}${({ overview: overviewPage, study: studyPage, exams: examsPage, calendar: calendarPage, planning: planningPage, export: exportPage, settings: settingsPage, admin: adminPage })[page]()}</section>`;
  $('#save-status').textContent = 'Version ' + store.revision;
  if (page === 'admin' && !adminData) loadAdmin();
}
function noProfile() {
  return `<div class="onboarding"><div><span class="chapter-number" aria-hidden="true">01</span><h2>Hier beginnt dein Studienplan.</h2><p>Lege dein Studium an. Danach kannst du Module, Prüfungen und Lernaufgaben eintragen. Alles lässt sich später ändern.</p><div class="inline-actions">${primary('Studienprofil anlegen', 'profile-new')}${store.mode === 'server' ? button('Vorlagen ansehen', 'templates') : ''}</div></div><div class="onboarding-note"><strong>Dein Plan gehört dir.</strong><p>Persönliche Anpassungen ändern keine zentralen Hochschuldaten. Fehlende Angaben bleiben als offen erkennbar.</p><span class="edited-label">Von dir bearbeitet</span></div></div>`;
}
function overviewPage() {
  const p = profile();
  const greet = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() >= 18 ? 'Guten Abend' : 'Guten Tag';
  const head = heading(`${greet}${store.user ? ', ' + store.user.username : ''}.`, date(Date.now(), { weekday: 'long', year: 'numeric' }), p ? `<div class="semester-stamp"><span>Semester</span><strong>${String(p.currentSemester).padStart(2, '0')}</strong></div>` : '');
  if (!p) return head + noProfile();
  const stats = summary(state, p.id), percent = Math.min(100, Math.round(stats.ects / p.targetEcts * 100));
  const events = sortedEvents().filter(e => eventInstant(e) + e.duration * 60000 >= Date.now());
  const tasks = items('tasks').filter(t => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const widgets = {
    progress: `<article class="panel progress-panel"><div class="card-heading"><div><span class="section-label">Studienfortschritt</span><h2>${fmt(stats.ects)} <span class="muted">von ${fmt(p.targetEcts)} ECTS</span></h2></div>${button('Studienplan öffnen →', 'navigate', 'study', 'text-button')}</div><div class="progress-layout"><div class="progress-ring" role="img" aria-label="${percent} Prozent erreicht"><svg viewBox="0 0 132 132" aria-hidden="true"><circle class="ring-track" cx="66" cy="66" r="54"/><circle class="ring-value" cx="66" cy="66" r="54" style="stroke-dasharray:339.3;stroke-dashoffset:${339.3 * (1 - percent / 100)}"/></svg><div><strong>${percent}%</strong><span>erreicht</span></div></div><dl class="progress-details"><div><dt>Bestanden</dt><dd>${stats.passed} Module</dd></div><div><dt>In Arbeit</dt><dd>${stats.active} Module</dd></div><div><dt>Notenschnitt</dt><dd>${fmt(stats.average)}</dd></div><div><dt>Noch bis zum Ziel</dt><dd>${fmt(Math.max(0, p.targetEcts - stats.ects))} ECTS</dd></div></dl></div><p class="small muted">Notenschnitt nach ECTS der benoteten, bestandenen Module. Abweichende Regeln deiner Prüfungsordnung sind möglich.</p></article>`,
    exams: `<article class="panel appointments-panel"><div class="card-heading"><div><span class="section-label">Als Nächstes</span><h2>Deine Termine</h2></div>${button('Alle ansehen →', 'navigate', 'exams', 'text-button')}</div>${events.length ? events.slice(0, 3).map(eventRow).join('') : empty('Ein freier Blick nach vorn.', 'Trage deine nächste Prüfung oder Abgabe ein.', button('Termin eintragen', 'event-new'))}</article>`,
    tasks: `<article class="panel"><div class="card-heading"><div><span class="section-label">Ein Schritt weiter</span><h2>${tasks.length} offene ${tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'}</h2></div>${button('Lernplanung →', 'navigate', 'planning', 'text-button')}</div>${tasks.length ? tasks.slice(0, 4).map(taskRow).join('') : empty('Platz für den nächsten Schritt.', 'Halte eine kleine, konkrete Lernaufgabe fest.', button('Aufgabe hinzufügen', 'task-new'))}</article>`,
    note: `<article class="panel note-panel"><span class="section-label">Nur für dich</span><h2>Ein Gedanke für später.</h2><label for="quick-note" class="sr-only">Persönliche Notiz</label><textarea id="quick-note" rows="5" maxlength="10000" placeholder="Was möchtest du im Blick behalten?">${escape(state.settings.note)}</textarea><div class="note-footer"><span class="small muted">Wird mit „Speichern“ übernommen.</span>${button('Speichern', 'note-save', '', 'save-button pressable')}</div></article>`
  };
  return head + `<div class="dashboard-v1">${state.settings.widgets.map(key => widgets[key]).join('') || empty('Deine Übersicht ist aufgeräumt.', 'Über „Ansicht anpassen“ kannst du Bereiche wieder einblenden.', button('Ansicht anpassen', 'customize'))}</div><section class="recent-modules"><div class="card-heading"><h2>Dein aktuelles Semester</h2>${primary('Modul hinzufügen', 'module-new')}</div>${items('modules').filter(m => m.semester === p.currentSemester).length ? items('modules').filter(m => m.semester === p.currentSemester).map(moduleRow).join('') : empty('Noch keine Module in diesem Semester.', 'Füge dein erstes Modul hinzu oder ändere die Semesterzuordnung im Studienplan.')}</section>`;
}
function moduleRow(m) {
  const missing = unmet(state, m);
  return `<article class="module-entry"><div class="module-semester" aria-label="Semester ${m.semester}">${String(m.semester).padStart(2, '0')}</div><div class="module-entry-body"><button class="module-title" data-action="module-edit" data-id="${escape(m.id)}">${escape(m.name)}</button><div class="module-meta"><span>${escape(m.code || 'Modulnummer offen')}</span><span class="edited-label">Von dir bearbeitet</span>${missing.length ? `<span class="requirement-note">${missing.length} Voraussetzung${missing.length === 1 ? '' : 'en'} offen</span>` : ''}</div></div><div class="module-credit"><strong>${fmt(m.ects)}</strong><span>ECTS</span></div><div class="module-result">${statusPill(m)}<small>${m.grade != null ? 'Note ' + fmt(m.grade) : 'Note offen'} · ${m.attempts} ${m.attempts === 1 ? 'Versuch' : 'Versuche'}</small></div><div class="row-actions">${button('Bearbeiten', 'module-edit', m.id, 'text-button')}${button('<span aria-hidden="true">×</span><span class="delete-text">Entfernen</span>', 'module-delete', m.id, 'delete-action')}</div></article>`;
}
function studyPage() {
  const p = profile(); if (!p) return heading('Dein Studienplan', 'Ein Plan, der sich an deinen Alltag anpasst.') + noProfile();
  const list = items('modules').filter(m => (!filter || m.status === filter) && (!semester || String(m.semester) === semester) && `${m.name} ${m.code}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, 'de'));
  const stats = summary(state, p.id), required = items('modules').filter(m => m.thesisRequired), done = required.filter(m => m.status === 'passed').length;
  const sems = [...new Set([...Array.from({ length: p.semesters }, (_, i) => i + 1), ...items('modules').map(m => m.semester)])].sort((a, b) => a - b);
  return heading(p.name, [p.university, p.degree, p.po ? 'PO ' + p.po : 'Prüfungsordnung offen'].filter(Boolean).join(' · '), button('Studienprofil bearbeiten', 'profile-edit', p.id) + primary('Neues Modul', 'module-new')) + `<div class="study-strip"><span><strong>${fmt(stats.ects)}</strong> / ${fmt(p.targetEcts)} ECTS</span><span><strong>${items('modules').length}</strong> Module</span><span><strong>${fmt(stats.average)}</strong> Notenschnitt</span>${link(p.source, 'Quelle des Studienplans')}</div><div class="filter-bar"><label class="search-field"><span class="sr-only">Module suchen</span><input id="module-search" type="search" placeholder="Modul oder Nummer suchen" value="${escape(query)}"></label>${select('Status', 'status-filter', { '': 'Alle Status', ...STATUS }, filter)}${select('Semester', 'semester-filter', Object.fromEntries([['', 'Alle Semester'], ...sems.map(n => [n, `Semester ${n}`])]), semester)}</div><div id="module-results">${list.length ? list.map(moduleRow).join('') : empty('Hier ist noch Platz.', query || filter || semester ? 'Passe deine Suche oder Filter an.' : 'Trage die Module aus deiner Prüfungsordnung ein.', !query && !filter && !semester ? primary('Erstes Modul anlegen', 'module-new') : '')}</div><div class="panel thesis-panel"><div><span class="section-label">Abschlussarbeit im Blick</span><h2>Deine hinterlegten Voraussetzungen</h2><p>${required.length ? `${done} von ${required.length} erforderlichen Modulen bestanden.` : 'Noch keine erforderlichen Module markiert.'} ${p.thesisEcts ? `${fmt(stats.ects)} von ${fmt(p.thesisEcts)} hinterlegten Mindest-ECTS erreicht.` : 'Mindest-ECTS noch offen.'}</p><p class="small muted">Diese Orientierung nutzt deine eigenen Angaben. Die verbindliche Zulassung entscheidet deine Hochschule.</p></div>${button('Voraussetzungen festlegen', 'profile-edit', p.id)}</div>`;
}
function eventRow(e) {
  const instant = eventInstant(e), past = instant + e.duration * 60000 < Date.now();
  return `<article class="event-entry ${past ? 'is-past' : ''}"><div class="event-date"><strong>${e.start.slice(8, 10)}</strong><span>${date(e.start, { month: 'short', day: undefined })}</span></div><div class="event-entry-body"><button class="module-title" data-action="event-edit" data-id="${escape(e.id)}">${escape(e.title)}</button><p>${escape(KINDS[e.kind])} · ${e.start.slice(11, 16)} · ${escape(e.timezone)}${e.location ? ' · ' + escape(e.location) : ''}</p><small>${past ? 'Vergangener Termin' : 'In ' + Math.max(0, Math.ceil((instant - Date.now()) / 86400000)) + ' Tagen'} · ${e.duration} Min.</small></div><div class="row-actions">${button('Kalender ↗', 'event-export', e.id, 'text-button')}${button('Bearbeiten', 'event-edit', e.id, 'text-button')}${button('Entfernen', 'event-delete', e.id, 'text-button danger-text')}</div></article>`;
}
function examsPage() {
  const p = profile(); if (!p) return heading('Prüfungen & Fristen', 'Klausuren, Abgaben und Anmeldung an einem Ort.') + noProfile();
  const events = sortedEvents().filter(e => (showPast || eventInstant(e) + e.duration * 60000 >= Date.now()) && (!filter || e.kind === filter));
  return heading('Gut vorbereitet ankommen.', 'Deine Prüfungen, Abgaben und Fristen. Jeder Termin lässt sich in deinen Kalender übernehmen.', primary('Termin eintragen', 'event-new')) + `<div class="filter-bar">${select('Terminart', 'event-filter', { '': 'Alle Termine', ...KINDS }, filter)}${check('Vergangene Termine anzeigen', 'show-past', showPast)}</div><div class="panel events-panel">${events.length ? events.map(eventRow).join('') : empty('Keine Termine in dieser Auswahl.', 'Ergänze eine Prüfung, eine Abgabe oder eine persönliche Frist.', primary('Termin eintragen', 'event-new'))}</div><p class="small muted">Kalenderexporte erinnern eine Woche und einen Tag vorher. Nach einer Änderung muss eine bereits importierte Kalenderkopie aktualisiert werden.</p>`;
}
function calendarPage() {
  if (!profile()) return heading('Dein Kalender', 'Ein Monat auf einen Blick.') + noProfile();
  const year = month.getFullYear(), mo = month.getMonth(), first = new Date(year, mo, 1), offset = (first.getDay() + 6) % 7, length = new Date(year, mo + 1, 0).getDate();
  const events = sortedEvents(), cells = [];
  for (let i = 0; i < Math.ceil((offset + length) / 7) * 7; i++) {
    const d = new Date(year, mo, i - offset + 1), key = dayKey(d), daily = events.filter(e => e.start.slice(0, 10) === key);
    cells.push(`<div class="calendar-day ${d.getMonth() !== mo ? 'outside-month' : ''} ${key === dayKey() ? 'today' : ''}"><button class="day-number" data-action="event-on-day" data-id="${key}" aria-label="Termin am ${escape(date(d, { year: 'numeric' }))} hinzufügen">${d.getDate()}</button>${daily.slice(0, 3).map(e => `<button class="calendar-event" data-action="event-edit" data-id="${escape(e.id)}" title="${escape(e.title)}">${e.start.slice(11, 16)} ${escape(e.title)}</button>`).join('')}${daily.length > 3 ? `<span class="small">+ ${daily.length - 3} weitere</span>` : ''}</div>`);
  }
  const current = events.filter(e => e.start.slice(0, 7) === `${year}-${String(mo + 1).padStart(2, '0')}`);
  return heading('Dein Kalender', 'Termine erscheinen am Datum ihrer eingetragenen Zeitzone.', primary('Termin eintragen', 'event-new')) + `<div class="panel calendar-panel"><div class="card-heading"><h2>${date(month, { month: 'long', year: 'numeric', day: undefined })}</h2><div class="inline-actions">${button('←', 'month', '-1', 'icon-button')}${button('Heute', 'month-today')}${button('→', 'month', '1', 'icon-button')}</div></div><div class="calendar-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="weekday">${d}</div>`).join('')}${cells.join('')}</div></div><h2 class="subheading">Termine in diesem Monat</h2><div class="panel">${current.length ? current.map(eventRow).join('') : empty('Noch keine Termine in diesem Monat.', 'Wähle einen Tag, um etwas einzutragen.')}</div>`;
}
function taskRow(t) {
  const overdue = !t.done && t.due && t.due < dayKey();
  return `<article class="task-entry ${t.done ? 'is-done' : ''}"><label class="task-check"><input type="checkbox" data-task-toggle="${escape(t.id)}" ${t.done ? 'checked' : ''} aria-label="${escape(t.title)} als ${t.done ? 'offen' : 'erledigt'} markieren"><span aria-hidden="true">✓</span></label><div><button class="task-title" data-action="task-edit" data-id="${escape(t.id)}">${escape(t.title)}</button><p>${t.due ? date(t.due + 'T12:00', { year: 'numeric' }) : 'Ohne Frist'} · ${t.minutes} Min.${overdue ? ' · Überfällig' : ''}</p></div>${button('Bearbeiten', 'task-edit', t.id, 'text-button')}</article>`;
}
function planningPage() {
  if (!profile()) return heading('Deine nächste Lerneinheit.', 'Aus großen Vorhaben werden konkrete Schritte.') + noProfile();
  const tasks = items('tasks').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const today = dayKey(), end = new Date(); end.setDate(end.getDate() + 7);
  const due = tasks.filter(t => !t.done && t.due && t.due <= dayKey(end));
  const groups = [ ['Jetzt dran', tasks.filter(t => !t.done && t.due && t.due <= today)], ['Als Nächstes', tasks.filter(t => !t.done && (!t.due || t.due > today))], ['Erledigt', tasks.filter(t => t.done)] ];
  return heading('Deine nächste Lerneinheit.', 'Plane kleine Schritte und hake ab, was du geschafft hast.', primary('Aufgabe hinzufügen', 'task-new')) + `<div class="planning-summary"><strong>${fmt(due.reduce((n, t) => n + t.minutes, 0) / 60)} Stunden</strong><span>offener Lernaufwand bis ${date(end)} inklusive überfälliger Aufgaben</span><span>${tasks.filter(t => t.done).length} von ${tasks.length} Aufgaben erledigt</span></div><div class="task-board">${groups.map(([name, list]) => `<section class="task-column"><div class="card-heading"><h2>${name}</h2><span class="count-label">${list.length}</span></div>${list.length ? list.map(taskRow).join('') : '<p class="muted small">Hier ist gerade nichts eingetragen.</p>'}</section>`).join('')}</div>`;
}
function exportPage() {
  return heading('Dein Studium zum Mitnehmen.', 'Für deine Ablage, als Kalenderdatei oder zum Weiterarbeiten.') + `<div class="export-layout"><form id="export-form" class="panel"><h2>Studienübersicht</h2><p>Wähle aus, was in deiner Übersicht stehen soll.</p><div class="form-grid">${select('Studienprofil', 'profile', { '': 'Alle Studienprofile', ...Object.fromEntries(state.profiles.map(p => [p.id, p.name])) }, profile()?.id || '')}${select('Dateiformat', 'format', { pdf: 'PDF · Moduly Minimal', md: 'Markdown', txt: 'Textdatei', csv: 'CSV · Modulliste', ics: 'ICS · Kalender' }, store.mode === 'preview' ? 'md' : 'pdf')}</div><div class="export-options">${check('Noten anzeigen', 'grades', true)}${check('Versuche anzeigen', 'attempts', true)}${check('Termine aufnehmen', 'events', true)}${check('Offene Module aufnehmen', 'open', true)}${check('Persönliche Notizen aufnehmen', 'notes')}</div><p class="small muted">CSV enthält die Modulliste, ICS die Termine. PDF wird in der Gerätevorschau über den Druckdialog erstellt.</p><button type="submit" class="button-primary pressable">Übersicht exportieren <span class="button-arrow" aria-hidden="true">↗</span></button><p class="form-error" role="alert" tabindex="-1" hidden></p></form><div class="export-aside"><article class="panel"><span class="section-label">Alles in einer Datei</span><h2>Vollständige Datensicherung</h2><p>JSON enthält sämtliche Studienprofile, Einträge und Notizen${store.mode === 'server' ? ' sowie deine Kontodaten und Meldungen' : ''}. Passwörter und Wiederherstellungscodes sind ausgeschlossen.</p>${primary('JSON herunterladen', 'json-export')}<p class="small muted">Unabhängig von den Filtern der Studienübersicht. Bewahre die Datei privat auf.</p></article><article class="panel"><h2>Sicherung wieder einlesen</h2><p>Du siehst den Inhalt vor dem Import. Die Studienpläne werden vollständig durch die Datei ersetzt. Das Konto und sein Passwort bleiben bestehen.</p><label class="file-label">JSON-Datei auswählen<input type="file" id="import-file" accept=".json,application/json"></label></article></div></div>`;
}
function settingsPage() {
  const preview = store.mode === 'preview';
  return heading('So passt Moduly zu dir.', 'Deine Studienprofile, deine Ansicht und dein Konto.') + `<div class="settings-v1"><section class="panel"><h2>Studienprofile</h2><p>Beim Wechsel bleiben deine bisherigen Einträge erhalten. Ein Archiv gehört weiterhin nur zu deinem Konto.</p>${state.profiles.map(p => `<div class="setting-row"><div><strong>${escape(p.name)}</strong><small>${escape(p.university || 'Hochschule offen')}${p.archived ? ' · Archiviert' : ''}</small></div><div class="inline-actions">${button('Bearbeiten', 'profile-edit', p.id, 'text-button')}${button(p.archived ? 'Aktivieren' : 'Archivieren', 'profile-archive', p.id, 'text-button')}${button('Löschen', 'profile-delete', p.id, 'text-button danger-text')}</div></div>`).join('') || '<p class="muted">Noch kein Studienprofil angelegt.</p>'}<div class="inline-actions">${primary('Studienprofil hinzufügen', 'profile-new')}${!preview ? button('Vorlagen', 'templates') : ''}</div></section><section class="panel"><h2>Deine Ansicht</h2><p>Reihenfolge, sichtbare Bereiche, kompakte Zeilen und Bewegung selbst festlegen.</p>${button('Ansicht anpassen', 'customize')}<div class="setting-row"><div><strong>Darstellung</strong><small>Helle oder kontrastreiche dunkle Oberfläche.</small></div>${button(state.settings.theme === 'dark' ? 'Hell verwenden' : 'Dunkel verwenden', 'theme')}</div></section><section class="panel"><h2>${preview ? 'Gerätevorschau' : 'Konto & Sicherheit'}</h2>${preview ? `<p>Diese Vorschau hat keine Benutzerkonten. Sie speichert ausschließlich in diesem Browser. Für mehrere Geräte verwende die Serverversion.</p>${button('Vorschau zurücksetzen', 'reset-preview', '', 'quiet-button danger-text')}` : `<div class="setting-row"><div><strong>${escape(store.user.username)}</strong><small>Benutzername, Groß-/Kleinschreibung wird bei Eindeutigkeit nicht unterschieden.</small></div>${button('Ändern', 'security', 'username')}</div><div class="security-actions">${button('Passwort ändern', 'security', 'password')}${button('Neuer Wiederherstellungscode', 'security', 'recovery')}${button('Andere Sitzungen abmelden', 'security', 'sessions')}${button('Abmelden', 'logout')}</div>`}</section><section class="panel"><h2>Deine Daten</h2><p>Studiendaten und private Notizen werden ${preview ? 'auf diesem Gerät' : 'in deinem Konto'} gespeichert. Du kannst sie exportieren und löschen.</p><div class="inline-actions">${button('Export & Import öffnen', 'navigate', 'export')}${!preview ? button('Frühere Version wiederherstellen', 'history') : ''}</div>${!preview ? `<div class="danger-zone"><strong>Konto endgültig löschen</strong><p>Entfernt Studienprofile, Termine, Aufgaben und Meldungen. Dein aktuelles Passwort wird zur Bestätigung benötigt.</p>${button('Konto löschen', 'account-delete', '', 'quiet-button danger-text')}</div>` : ''}</section>${!preview ? `<section class="panel"><h2>Fehler & Rückfragen</h2><p>Eine Meldung enthält nur den Text, den du selbst eingibst. Deine Studiendaten werden nicht mitgeschickt.</p><div class="inline-actions">${button('Problem melden', 'report')}${button('Meine Meldungen', 'reports')}</div></section>` : ''}</div>`;
}
function adminPage() {
  if (!['admin', 'owner'].includes(store.user?.role)) return empty('Keine Berechtigung.', 'Dieser Bereich ist für die Verwaltung vorgesehen.');
  if (!adminData) return heading('Verwaltung', 'Status und eingegangene Meldungen werden geladen.');
  const backup = adminData.backup;
  return heading('Verwaltung', 'Meldungen bearbeiten, ohne private Studienpläne einzusehen.', button('Aktualisieren', 'admin-refresh')) + `<div class="admin-status panel"><span><strong>${adminData.users}</strong> Konten</span><span>Datenbank: <strong>${escape(adminData.database)}</strong></span><span>Backup: <strong>${backup?.ok ? 'Geprüft am ' + date(backup.verifiedAt * 1000, { year: 'numeric' }) : backup ? 'Fehlgeschlagen' : 'Noch kein Backup'}</strong></span></div><div class="panel"><h2>Meldungen</h2>${adminData.reports.length ? adminData.reports.map(r => `<article class="report-entry"><span class="section-label">${escape(r.category)} · ${escape(r.status)}</span><p class="prewrap">${escape(r.message)}</p>${r.response ? `<p>Antwort: ${escape(r.response)}</p>` : ''}${button('Bearbeiten', 'report-review', r.id)}</article>`).join('') : '<p>Noch keine Meldungen.</p>'}</div><div class="panel"><h2>Änderungsprotokoll</h2>${adminData.audit.map(a => `<p>${escape(a.action)} · ${date(a.created_at * 1000, { year: 'numeric' })}</p>`).join('') || '<p>Noch keine Verwaltungsaktionen.</p>'}</div>`;
}
async function loadAdmin() { try { adminData = await store.request('admin'); if (page === 'admin') render(); } catch (error) { showError(error); } }

function editProfile(profileId) {
  const existing = state.profiles.find(p => p.id === profileId);
  const p = existing || { id: id(), name: '', university: '', degree: 'Bachelor', po: '', targetEcts: 180, semesters: 6, currentSemester: 1, archived: false, thesisEcts: 0, source: '' };
  openDialog(existing ? 'Studienprofil bearbeiten' : 'Dein Studium anlegen', `<p class="span-2 form-intro">Diese Angaben gehören nur zu deinem Plan. Übernimm ECTS und Voraussetzungen aus deiner Prüfungsordnung; unbekannte Angaben kannst du später ergänzen.</p>${field('Studiengang *', 'name', p.name, 'text', 'required maxlength="150" placeholder="Wie heißt dein Studiengang?"')}${field('Hochschule', 'university', p.university, 'text', 'maxlength="150"')}${field('Abschluss', 'degree', p.degree, 'text', 'maxlength="80"')}${field('Prüfungsordnung / Version', 'po', p.po, 'text', 'maxlength="80" placeholder="z. B. PO 2025"')}${field('ECTS für den Abschluss *', 'targetEcts', p.targetEcts, 'number', 'required min="1" max="1000" step="0.5"')}${field('Regelstudienzeit (Semester)', 'semesters', p.semesters, 'number', 'required min="1" max="20" step="1"')}${field('Dein aktuelles Semester', 'currentSemester', p.currentSemester, 'number', 'required min="1" max="30" step="1"')}${field('Mindest-ECTS für die Abschlussarbeit', 'thesisEcts', p.thesisEcts || '', 'number', 'min="0" max="1000" step="0.5" placeholder="Offen"')}${field('Offizielle Quelle (optional)', 'source', p.source, 'url', 'maxlength="1000" placeholder="https://…"')}<p class="small muted span-2">Erforderliche Module für die Abschlussarbeit markierst du im jeweiligen Modul. Der Voraussetzungencheck ersetzt keine Zulassungsentscheidung.</p>`, async form => {
    const next = { ...p, name: val(form, 'name'), university: val(form, 'university'), degree: val(form, 'degree'), po: val(form, 'po'), targetEcts: num(form, 'targetEcts'), semesters: num(form, 'semesters'), currentSemester: num(form, 'currentSemester'), thesisEcts: num(form, 'thesisEcts'), source: val(form, 'source') };
    await mutate(data => { const index = data.profiles.findIndex(x => x.id === p.id); if (index >= 0) data.profiles[index] = next; else data.profiles.push(next); data.settings.activeProfile = p.id; }, existing ? 'Studienprofil aktualisiert' : 'Dein Studienprofil ist angelegt');
  });
}
function componentMarkup() {
  return currentComponents.map(c => `<div class="component-row" data-component="${escape(c.id)}">${field('Bestandteil', 'c-name', c.name, 'text', 'required maxlength="150"')}${field('Gewicht (%)', 'c-weight', c.weight, 'number', 'required min="0" max="100" step="0.1"')}${field('Note', 'c-grade', c.grade ?? '', 'number', 'min="1" max="5" step="0.1"')}${check('Erforderlich', 'c-required', c.required)}${check('Bestanden', 'c-passed', c.passed)}${button('Entfernen', 'component-remove', c.id, 'text-button danger-text')}</div>`).join('') || '<p class="small muted">Optional: z. B. Klausur 70 %, Präsentation 30 % oder ein unbenotetes Pflichtlabor.</p>';
}
function readComponents() {
  return [...document.querySelectorAll('[data-component]')].map(row => {
    const get = name => row.querySelector(`[name="${name}"]`);
    return { id: row.dataset.component, name: get('c-name').value.trim(), weight: Number(get('c-weight').value), grade: get('c-grade').value === '' ? null : Number(get('c-grade').value), required: get('c-required').checked, passed: get('c-passed').checked };
  });
}
function editModule(moduleId) {
  const p = profile(); if (!p) return editProfile();
  const existing = state.modules.find(m => m.id === moduleId);
  const m = existing || { id: id(), profileId: p.id, name: '', code: '', ects: 5, semester: p.currentSemester, status: 'open', grade: null, attempts: 0, examType: '', duration: 0, materials: '', notes: '', source: '', sourceDate: '', prerequisites: [], thesisRequired: false, components: [], edited: true };
  currentComponents = clone(m.components);
  openDialog(existing ? m.name : 'Ein Modul hinzufügen', `<p class="span-2 form-intro"><span class="edited-label">Von dir bearbeitet</span> ECTS zählen pro Modul genau einmal, auch bei mehreren Prüfungsbestandteilen.</p>${field('Modulname *', 'name', m.name, 'text', 'required maxlength="150"')}${field('Modulnummer', 'code', m.code, 'text', 'maxlength="60" placeholder="Offen"')}${field('ECTS *', 'ects', m.ects, 'number', 'required min="0" max="60" step="0.5"')}${field('Semester *', 'semester', m.semester, 'number', 'required min="1" max="30" step="1"')}${select('Status', 'status', STATUS, m.status)}${field('Gesamtnote', 'grade', m.grade ?? '', 'number', 'min="1" max="5" step="0.1" placeholder="Noch offen / unbenotet"')}${field('Bisherige Prüfungsversuche', 'attempts', m.attempts, 'number', 'required min="0" max="20" step="1"')}${field('Prüfungsart', 'examType', m.examType, 'text', 'maxlength="80" placeholder="z. B. Klausur"')}${field('Prüfungsdauer (Minuten)', 'duration', m.duration || '', 'number', 'min="0" max="600" step="1" placeholder="Offen"')}${field('Quelle zuletzt geprüft am', 'sourceDate', m.sourceDate, 'date')}${field('Offizielle Quelle', 'source', m.source, 'url', 'maxlength="1000" placeholder="https://…"')}${area('Erlaubte Hilfsmittel / Prüfungsumfang', 'materials', m.materials, 2000)}${area('Persönliche Notizen', 'notes', m.notes, 10000)}<details class="span-2 form-details"><summary>Prüfungsbestandteile</summary><p class="small muted">Die Gesamtnote trägst du nach den Regeln deiner Hochschule oben ein. Gewichtungen dienen der Übersicht.</p><div id="components">${componentMarkup()}</div>${button('Bestandteil hinzufügen', 'component-add')}</details><details class="span-2 form-details"><summary>Voraussetzungen & Abschlussarbeit</summary><p class="small muted">Welche Module müssen vorher bestanden sein?</p>${items('modules').filter(other => other.id !== m.id).map(other => check(escape(other.name), 'prerequisites', m.prerequisites.includes(other.id), other.id)).join('') || '<p class="small muted">Noch keine anderen Module vorhanden.</p>'}${check('Für die Zulassung zur Abschlussarbeit erforderlich', 'thesisRequired', m.thesisRequired)}</details>`, async form => {
    const next = { ...m, name: val(form, 'name'), code: val(form, 'code'), ects: num(form, 'ects'), semester: num(form, 'semester'), status: val(form, 'status'), grade: val(form, 'grade') === '' ? null : num(form, 'grade'), attempts: num(form, 'attempts'), examType: val(form, 'examType'), duration: num(form, 'duration'), materials: val(form, 'materials'), notes: val(form, 'notes'), source: val(form, 'source'), sourceDate: val(form, 'sourceDate'), prerequisites: new FormData(form).getAll('prerequisites'), thesisRequired: checked(form, 'thesisRequired'), components: readComponents(), edited: true };
    await mutate(data => { const index = data.modules.findIndex(x => x.id === m.id); if (index >= 0) data.modules[index] = next; else data.modules.push(next); }, next.status === 'passed' && m.status !== 'passed' ? 'Bestanden. Dein Fortschritt wurde aktualisiert.' : 'Modul gespeichert');
  });
}
function editEvent(eventId, onDay) {
  const p = profile(); if (!p) return editProfile();
  const existing = state.events.find(e => e.id === eventId);
  const e = existing || { id: id(), profileId: p.id, moduleId: '', title: '', start: onDay ? `${onDay}T09:00` : localInput(), timezone: 'Europe/Berlin', duration: 90, kind: 'exam', location: '', notes: '' };
  openDialog(existing ? 'Termin bearbeiten' : 'Ein Termin, den du im Blick hast.', `${field('Titel *', 'title', e.title, 'text', 'required maxlength="150"')}${select('Terminart', 'kind', KINDS, e.kind)}${select('Zugehöriges Modul', 'moduleId', { '': 'Kein Modul / persönliche Frist', ...Object.fromEntries(items('modules').map(m => [m.id, m.name])) }, e.moduleId)}${field('Datum und Uhrzeit *', 'start', e.start, 'datetime-local', 'required min="2000-01-01T00:00" max="2100-12-31T23:59"')}${field('Zeitzone *', 'timezone', e.timezone, 'text', 'required maxlength="60" list="timezones"')}<datalist id="timezones"><option value="Europe/Berlin"><option value="Europe/London"><option value="America/New_York"><option value="Asia/Tokyo"><option value="UTC"></datalist>${field('Dauer (Minuten) *', 'duration', e.duration, 'number', 'required min="1" max="1440" step="1"')}${field('Ort / Raum', 'location', e.location, 'text', 'maxlength="300"')}${area('Notizen', 'notes', e.notes)}<p class="small muted span-2">Bei doppelt vorkommender Uhrzeit während der Herbst-Zeitumstellung gilt das erste Vorkommen. Ein Kalenderexport enthält Erinnerungen eine Woche und einen Tag vorher.${existing ? ' Aktualisiere nach dem Bearbeiten auch deine bereits importierte Kalenderkopie.' : ''}</p>`, async form => {
    const next = { ...e, title: val(form, 'title'), kind: val(form, 'kind'), moduleId: val(form, 'moduleId'), start: val(form, 'start'), timezone: val(form, 'timezone'), duration: num(form, 'duration'), location: val(form, 'location'), notes: val(form, 'notes') };
    await mutate(data => { const index = data.events.findIndex(x => x.id === e.id); if (index >= 0) data.events[index] = next; else data.events.push(next); }, existing ? 'Termin gespeichert. Kalenderkopie bei Bedarf aktualisieren.' : 'Termin eingetragen');
  });
}
function editTask(taskId) {
  const p = profile(); if (!p) return editProfile();
  const existing = state.tasks.find(t => t.id === taskId);
  const t = existing || { id: id(), profileId: p.id, title: '', due: '', done: false, minutes: 60, notes: '' };
  openDialog(existing ? 'Lernaufgabe bearbeiten' : 'Was nimmst du dir vor?', `${field('Dein nächster Schritt *', 'title', t.title, 'text', 'required maxlength="300" placeholder="z. B. Kapitel 2 zusammenfassen"')}${field('Bis wann?', 'due', t.due, 'date')}${field('Geplanter Aufwand (Minuten)', 'minutes', t.minutes, 'number', 'required min="0" max="10000" step="1"')}${check('Bereits erledigt', 'done', t.done)}${area('Notizen', 'notes', t.notes)}${existing ? `<div class="span-2">${button('Aufgabe entfernen', 'task-delete', t.id, 'text-button danger-text')}</div>` : ''}`, async form => {
    const next = { ...t, title: val(form, 'title'), due: val(form, 'due'), minutes: num(form, 'minutes'), done: checked(form, 'done'), notes: val(form, 'notes') };
    await mutate(data => { const index = data.tasks.findIndex(x => x.id === t.id); if (index >= 0) data.tasks[index] = next; else data.tasks.push(next); }, 'Lernaufgabe gespeichert');
  });
}
function widgetMarkup() {
  return widgetOrder.map((key, index) => `<div class="widget-order-row">${check(escape(WIDGETS[key]), 'widgets', state.settings.widgets.includes(key), key)}<div>${button('↑', 'widget-up', key, 'icon-button')}${button('↓', 'widget-down', key, 'icon-button')}<span class="sr-only">Position ${index + 1}</span></div></div>`).join('');
}
function customize() {
  widgetOrder = [...state.settings.widgets, ...Object.keys(WIDGETS).filter(w => !state.settings.widgets.includes(w))];
  openDialog('Deine Übersicht, deine Reihenfolge.', `<p class="span-2">Blende Bereiche aus und verschiebe sie mit den Pfeilen. Ausgeblendete Einträge bleiben gespeichert.</p><div id="widget-order" class="span-2">${widgetMarkup()}</div><div class="span-2">${check('Kompakte Zeilen', 'compact', state.settings.compact)}${check('Interaktive Animationen', 'motion', state.settings.motion)}</div><p class="small muted span-2">Die Einstellung „Bewegung reduzieren“ deines Geräts hat immer Vorrang.</p>`, async form => {
    const selected = new FormData(form).getAll('widgets');
    await mutate(data => { data.settings.widgets = widgetOrder.filter(w => selected.includes(w)); data.settings.compact = checked(form, 'compact'); data.settings.motion = checked(form, 'motion'); });
  });
}
function securityDialog(action) {
  const labels = { username: 'Benutzername ändern', password: 'Passwort ändern', recovery: 'Neuer Wiederherstellungscode', sessions: 'Andere Sitzungen abmelden' };
  openDialog(labels[action], `<p class="span-2">Bestätige mit deinem aktuellen Passwort. Andere angemeldete Geräte werden abgemeldet.${action === 'recovery' ? ' Dein bisheriger Wiederherstellungscode wird ungültig.' : ''}</p>${field('Aktuelles Passwort', 'password', '', 'password', 'required maxlength="128" autocomplete="current-password"')}${action === 'username' ? field('Neuer Benutzername', 'username', store.user.username, 'text', 'required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocapitalize="none" autocomplete="username"') : ''}${action === 'password' ? field('Neues Passwort', 'newPassword', '', 'password', 'required minlength="12" maxlength="128" autocomplete="new-password"') + field('Neues Passwort wiederholen', 'repeat', '', 'password', 'required minlength="12" maxlength="128" autocomplete="new-password"') : ''}`, async form => {
    if (action === 'password' && form.elements.newPassword.value !== form.elements.repeat.value) throw new Error('Die neuen Passwörter stimmen nicht überein.');
    const response = await store.request('account/security', 'POST', { action, password: form.elements.password.value, newPassword: form.elements.newPassword?.value, username: val(form, 'username') });
    store.accept(response); $('#username').textContent = store.user.username; render(); toast('Kontoeinstellung gespeichert');
    if (response.recoveryCode) { setTimeout(() => recoveryDialog(response.recoveryCode), 0); }
  });
}
function download(content, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function serverDownload(params) {
  const response = await fetch(new URL('api/export?' + params, document.baseURI), { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(error.error || 'Export fehlgeschlagen.', response.status); }
  const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'moduly-export';
  download(await response.blob(), filename);
}
async function fullExport() {
  if (store.mode === 'server') await serverDownload(new URLSearchParams({ format: 'json' }));
  else download(JSON.stringify({ format: 'moduly', version: 1, exportedAt: new Date().toISOString(), state }, null, 2), 'moduly.json', 'application/json');
  toast('Datensicherung erstellt');
}
function previewExport(form) {
  const format = val(form, 'format'), pid = val(form, 'profile'), data = clone(state);
  if (pid) { data.profiles = data.profiles.filter(p => p.id === pid); for (const key of ['modules', 'events', 'tasks']) data[key] = data[key].filter(row => row.profileId === pid); }
  if (!checked(form, 'open')) data.modules = data.modules.filter(m => m.status === 'passed');
  for (const m of data.modules) { if (!checked(form, 'grades')) m.grade = null; if (!checked(form, 'attempts')) m.attempts = null; }
  if (!checked(form, 'events')) data.events = [];
  if (!checked(form, 'notes')) { data.settings.note = ''; for (const key of ['modules', 'events', 'tasks']) data[key].forEach(row => { row.notes = ''; }); }
  if (format === 'ics') return download(calendar(data.events, data.modules), 'moduly-kalender.ics', 'text/calendar');
  if (format === 'csv') {
    const cell = value => { let str = String(value ?? ''); if (/^[\s]*[=+@-]/.test(str)) str = "'" + str; return '"' + str.replace(/"/g, '""') + '"'; };
    const rows = [['Studienprofil', 'Modul', 'Modulnummer', 'Semester', 'ECTS', 'Status', 'Note', 'Versuche', 'Quelle', 'Notizen'], ...data.modules.map(m => [data.profiles.find(p => p.id === m.profileId)?.name, m.name, m.code, m.semester, m.ects, STATUS[m.status], m.grade, m.attempts, m.source, m.notes])];
    return download('\ufeff' + rows.map(row => row.map(cell).join(';')).join('\r\n'), 'moduly-module.csv', 'text/csv');
  }
  const content = data.profiles.map(p => `## ${p.name}\n${p.university} · ${p.degree} · PO ${p.po || 'offen'}\n\n` + data.modules.filter(m => m.profileId === p.id).map(m => `- ${m.name}: ${fmt(m.ects)} ECTS · Semester ${m.semester} · ${STATUS[m.status]}${m.grade != null ? ' · Note ' + fmt(m.grade) : ''}${m.attempts != null ? ' · Versuche ' + m.attempts : ''}${m.notes ? '\n  ' + m.notes : ''}`).join('\n') + '\n\n### Termine\n' + data.events.filter(e => e.profileId === p.id).map(e => `- ${e.start} (${e.timezone}) · ${e.title} · ${e.location}${e.notes ? '\n  ' + e.notes : ''}`).join('\n') + '\n\n### Aufgaben\n' + data.tasks.filter(t => t.profileId === p.id).map(t => `- [${t.done ? 'x' : ' '}] ${t.title} · ${t.due} · ${t.minutes} Min.${t.notes ? '\n  ' + t.notes : ''}`).join('\n')).join('\n\n') + (data.settings.note ? '\n\nPersönliche Notiz\n' + data.settings.note : '');
  if (format === 'pdf') {
    const print = document.createElement('div'); print.id = 'print-export'; print.innerHTML = `<h1>Mein Studium</h1><p>Persönliche Einträge. Keine offizielle Leistungsübersicht.</p><div class="print-content">${escape(content)}</div>`; document.body.append(print); document.body.classList.add('printing');
    const cleanup = () => { print.remove(); document.body.classList.remove('printing'); };
    window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 60000); return;
  }
  download('# Mein Studium\n\nPersönliche Einträge. Keine offizielle Leistungsübersicht.\n\n' + content, 'moduly.' + format);
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error('Die Datei ist zu groß. Maximal 2 MB.');
  let parsed; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Die Datei enthält kein gültiges JSON.'); }
  if (parsed.format !== 'moduly' || parsed.version !== 1) throw new Error('Bitte eine Moduly-V1-Sicherung auswählen.');
  const imported = validateClient(parsed.state);
  confirmation('Sicherung übernehmen?', `Die Datei enthält ${imported.profiles.length} Studienprofile, ${imported.modules.length} Module, ${imported.events.length} Termine und ${imported.tasks.length} Aufgaben. Sie ersetzt deine aktuellen Studienpläne. Exportiere vorher bei Bedarf eine Sicherung. Dein Konto wird nicht geändert.`, async () => {
    await mutate(data => { for (const key of Object.keys(emptyState())) data[key] = imported[key]; }, 'Sicherung eingelesen');
  }, 'Studienpläne ersetzen');
}
async function showHistory() {
  const data = await store.request('history');
  openDialog('Frühere Versionen', `<p>Bis zu 20 frühere Speicherstände der letzten 30 Tage. Eine Wiederherstellung erzeugt eine neue Version.</p>${data.history.map(r => `<div class="setting-row"><div><strong>Version ${r.revision}</strong><small>${date(r.created_at * 1000, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div>${button('Wiederherstellen', 'history-restore', r.revision)}</div>`).join('') || '<p>Noch keine früheren Versionen vorhanden.</p>'}`);
}
async function showTemplates() {
  const data = await store.request('templates');
  openDialog('Studienvorlagen', `<p>Vorlagen werden vom Betreiber anhand verlinkter Quellen bereitgestellt. Du übernimmst eine persönliche Kopie; spätere Vorlagenänderungen überschreiben deinen Plan nicht.</p>${data.templates.map(t => `<article class="report-entry"><h3>${escape(t.data.profiles[0].name)}</h3><p>${escape(t.data.profiles[0].university)} · ${escape(t.data.profiles[0].po)} · Version ${t.version}</p>${link(t.data.profiles[0].source, 'Quelle ansehen')}<div>${button('Persönliche Kopie erstellen', 'template-use', t.id)}</div></article>`).join('') || empty('Noch keine Vorlagen veröffentlicht.', 'Du kannst dein eigenes Studienprofil anlegen und die Angaben aus deiner Prüfungsordnung übernehmen.', primary('Eigenes Profil anlegen', 'profile-new'))}`);
}
async function useTemplate(templateId) {
  const { templates } = await store.request('templates'), template = templates.find(t => t.id === templateId);
  if (!template) throw new Error('Vorlage nicht mehr verfügbar.');
  const data = clone(template.data), newProfileId = id(), map = new Map(data.modules.map(m => [m.id, id()]));
  const p = { ...data.profiles[0], id: newProfileId };
  const modules = data.modules.map(m => ({ ...m, id: map.get(m.id), profileId: newProfileId, prerequisites: m.prerequisites.map(ref => map.get(ref)), components: m.components.map(c => ({ ...c, id: id() })), edited: true }));
  await mutate(next => { next.profiles.push(p); next.modules.push(...modules); next.settings.activeProfile = newProfileId; }, 'Persönliche Kopie angelegt'); closeDialog(); navigate('study');
}
function reportDialog() {
  if (store.mode !== 'server' || !store.user) return openDialog('Problem melden', '<p>Meldungen sind im angemeldeten Konto auf dem Moduly-Server verfügbar.</p>');
  openDialog('Was funktioniert noch nicht?', `${select('Kategorie', 'category', { technical: 'Technischer Fehler', study: 'Hinweis zu Studiendaten', privacy: 'Datenschutz / Konto' })}${area('Deine Beschreibung *', 'message')}<p class="small muted span-2">Bitte keine Passwörter oder Wiederherstellungscodes angeben. Es werden keine Studienpläne, Screenshots oder Gerätedaten automatisch angehängt.</p>`, async form => {
    if (!val(form, 'message')) throw new Error('Bitte beschreibe dein Anliegen.');
    await store.request('reports', 'POST', { category: val(form, 'category'), message: val(form, 'message') }); toast('Deine Meldung wurde gespeichert');
  }, 'Meldung einreichen');
}
async function showReports() {
  const data = await store.request('reports'), statuses = { open: 'Offen', resolved: 'Bearbeitet', needs_information: 'Rückfrage' };
  openDialog('Meine Meldungen', data.reports.map(r => `<article class="report-entry"><strong>${statuses[r.status] || escape(r.status)}</strong><p class="prewrap">${escape(r.message)}</p>${r.response ? `<p class="report-response">Antwort: ${escape(r.response)}</p>` : '<p class="small muted">Noch keine Antwort.</p>'}</article>`).join('') || '<p>Noch keine Meldungen vorhanden.</p>');
}
function legal(kind) {
  const op = store.meta.operator || {}, preview = store.mode !== 'server';
  if (kind === 'imprint') {
    openDialog('Impressum', `<div class="legal-copy"><h3>Anbieter</h3>${op.name ? `<p class="prewrap">${escape(op.name)}<br>${escape(op.address)}</p><p>Kontakt: ${escape(op.email)}</p>` : '<p>Für diese technische Vorschau sind noch keine vollständigen Anbieterangaben hinterlegt. Die produktive Instanz benötigt die Angaben des tatsächlichen Betreibers.</p>'}<h3>Über Moduly</h3><p>Moduly ist ein persönlicher Studienplaner. Es besteht keine automatische Verbindung zu einer Hochschule. Deine Einträge und Berechnungen ersetzen keine offiziellen Prüfungs- oder Zulassungsentscheidungen.</p>${preview ? '<p>Du siehst die Gerätevorschau. Persönliche Nutzerkonten werden hier nicht angeboten.</p>' : ''}</div>`); return;
  }
  openDialog('Datenschutzhinweise', `<div class="legal-copy"><p>Version 1.0 · Stand 12. September 2026</p><h3>Verantwortlich</h3><p class="prewrap">${op.name ? `${escape(op.name)}<br>${escape(op.address)}<br>${escape(op.email)}` : 'Die Betreiberangaben der produktiven Instanz sind noch nicht hinterlegt.'}</p><h3>Was diese Version verarbeitet</h3>${preview ? '<p>Die Gerätevorschau speichert Studienprofile, Module, Noten, Versuche, Termine, Aufgaben und Einstellungen im lokalen Speicher dieses Browsers, sobald du die Vorschau nutzt. Beim Zurücksetzen werden diese Einträge entfernt. Es gibt keine Kontosynchronisierung.</p><p>Beim Abruf dieser Vorschau verarbeitet der Hostinganbieter technisch notwendige Verbindungsdaten. Eine GitHub-Pages-Vorschau wird von GitHub bereitgestellt; die endgültige Serverinstanz hat einen eigenen Betreiber.</p>' : `<p>Für dein Konto speichern wir Benutzername, Passwort-Hash, Hash des Wiederherstellungscodes, Rolle und Erstellungszeitpunkt. Hinzu kommen die von dir eingetragenen Studienprofile, Module, Noten, Prüfungsversuche, Termine, Aufgaben, Notizen und Einstellungen. Eine E-Mail-Adresse ist für normale Konten nicht erforderlich.</p><p>Die Verarbeitung für dein Konto und deinen Studienplan erfolgt zur Bereitstellung des von dir gewünschten Dienstes. Technische Schutzmaßnahmen dienen dem sicheren Betrieb. Für die Anmeldung wird ein notwendiges, für JavaScript nicht lesbares Sitzungscookie mit maximal sieben Tagen Laufzeit verwendet.</p><h3>Hosting und Zugriff</h3><p>${escape(op.host)}</p><p>Studieneinträge sind durch die Anwendung auf dein Konto beschränkt. Betreiber mit notwendigem Server- oder Datenbankzugriff können technisch auf gespeicherte Daten zugreifen. Die Anwendung protokolliert keine Anfrageinhalte; der Hostinganbieter kann technische Verbindungsdaten nach seinen Betriebsbedingungen verarbeiten.</p><h3>Sicherheit, Meldungen und Speicherfristen</h3><p>Zum Schutz vor automatisierten Anmeldeversuchen werden gekürzte Zeitfenster mit pseudonymisierten Kennungen genutzt. Die Anwendung speichert dafür keine rohe IP-Adresse. Abgelaufene Zähler werden bei der nächsten begrenzten Anfrage entfernt. Sitzungen werden spätestens nach sieben Tagen ungültig und bei neuen Anmeldungen bereinigt.</p><p>Private Meldungen enthalten deine Kategorie und Nachricht sowie gegebenenfalls die Antwort. Sie bleiben bis zur Kontolöschung gespeichert. Bis zu 20 frühere Planversionen werden für höchstens 30 Tage vorgehalten. Notwendige Verwaltungsaktionen werden in einem Änderungsprotokoll mit internen Kennungen aufgezeichnet.</p><p>Kontodaten bleiben bis zur Kontolöschung gespeichert. Dabei werden Studienpläne, Versionen, Sitzungen und Meldungen aus der aktiven Datenbank entfernt. Automatische verschlüsselte Backups werden bei planmäßigem Betrieb 30 Tage aufbewahrt. Ein getrenntes Löschjournal verhindert, dass gelöschte Konten beim Wiederherstellen wieder aktiv werden. Kennungen im Löschjournal werden für die sichere Wiederherstellung benötigt; das Betriebskonzept regelt ihre Bereinigung nach Ablauf aller entsprechenden Sicherungen.</p><h3>Deine Möglichkeiten</h3><p>Du kannst deine Angaben korrigieren, als JSON und weitere Formate exportieren sowie dein Konto in den Einstellungen löschen. Für Auskunft, Löschung, Einschränkung, Widerspruch oder andere Datenschutzanliegen erreichst du den Betreiber unter der oben genannten Kontaktadresse. Du kannst dich bei einer zuständigen Datenschutzaufsichtsbehörde beschweren.</p>`}<h3>Externe Dienste</h3><p>Moduly V1 lädt keine Werbung, Analysewerkzeuge, externen Schriftarten, KI-Dienste oder Discord-Integrationen. Quellenlinks werden erst beim Anklicken beim jeweiligen Anbieter geöffnet. Kalenderexporte werden als Datei heruntergeladen; es findet keine automatische Übertragung an einen Kalenderanbieter statt.</p>${op.privacyExtra ? `<h3>Weitere Angaben des Betreibers</h3><p class="prewrap">${escape(op.privacyExtra)}</p>` : ''}</div>`);
}

const actions = {
  'auth-mode': value => showAuth(value),
  preview: () => enter(),
  demo: () => confirmation('Mit Beispielen starten?', 'Vorhandene Einträge in dieser Gerätevorschau werden ersetzt. Beispieldaten bilden keine reale Prüfungsordnung ab.', async () => { state = await store.load(); await mutate(data => Object.assign(data, demoState()), 'Beispielplan angelegt'); await enter(); }, 'Beispiel laden'),
  'reset-preview': () => confirmation('Gerätevorschau zurücksetzen?', 'Alle Einträge dieser Vorschau werden aus diesem Browser gelöscht. Sichere sie bei Bedarf vorher als JSON.', async () => { localStorage.removeItem('moduly-preview-v1'); state = emptyState(); store.revision = 0; showAuth(); toast('Vorschau zurückgesetzt'); }, 'Vorschau löschen'),
  navigate: value => navigate(value),
  'profile-new': () => editProfile(), 'profile-edit': value => editProfile(value),
  'module-new': () => editModule(), 'module-edit': value => editModule(value),
  'event-new': () => editEvent(), 'event-edit': value => editEvent(value), 'event-on-day': value => editEvent(null, value),
  'task-new': () => editTask(), 'task-edit': value => editTask(value),
  'module-delete': value => confirmation('Modul entfernen?', 'Das Modul und seine Ergebnisse werden entfernt. Verknüpfte Termine bleiben erhalten; Modulverknüpfungen und Voraussetzungen auf dieses Modul werden gelöst.', () => mutate(data => removeModule(data, value), 'Modul entfernt'), 'Modul entfernen'),
  'event-delete': value => confirmation('Termin entfernen?', 'Der Termin wird aus Moduly entfernt. Eine bereits importierte Kopie in deinem Kalender musst du dort separat löschen.', () => mutate(data => { data.events = data.events.filter(e => e.id !== value); }, 'Termin entfernt'), 'Termin entfernen'),
  'task-delete': value => confirmation('Aufgabe entfernen?', 'Die Aufgabe und ihre Notiz werden entfernt.', () => mutate(data => { data.tasks = data.tasks.filter(t => t.id !== value); }, 'Aufgabe entfernt'), 'Aufgabe entfernen'),
  'profile-delete': value => confirmation('Studienprofil löschen?', 'Alle Module, Ergebnisse, Termine und Aufgaben dieses Studienprofils werden entfernt. Deine anderen Studienprofile bleiben erhalten.', () => mutate(data => removeProfile(data, value), 'Studienprofil entfernt'), 'Studienprofil löschen'),
  'profile-archive': value => mutate(data => { const p = data.profiles.find(p => p.id === value); p.archived = !p.archived; }, 'Archivstatus geändert'),
  'component-add': () => { currentComponents = readComponents(); if (currentComponents.length >= 20) throw new Error('Maximal 20 Bestandteile.'); currentComponents.push({ id: id(), name: '', weight: 0, grade: null, required: false, passed: false }); $('#components').innerHTML = componentMarkup(); },
  'component-remove': value => { currentComponents = readComponents().filter(c => c.id !== value); $('#components').innerHTML = componentMarkup(); },
  customize,
  'widget-up': value => moveWidget(value, -1), 'widget-down': value => moveWidget(value, 1),
  theme: () => mutate(data => { data.settings.theme = data.settings.theme === 'dark' ? 'light' : 'dark'; }),
  'note-save': () => { const note = $('#quick-note').value; return mutate(data => { data.settings.note = note; }, 'Notiz gespeichert'); },
  month: value => { month = new Date(month.getFullYear(), month.getMonth() + Number(value), 1); render(); },
  'month-today': () => { month = new Date(); render(); },
  'event-export': value => { const event = state.events.find(e => e.id === value); download(calendar([event], state.modules), 'moduly-termin.ics', 'text/calendar'); toast('Kalenderdatei erstellt'); },
  'json-export': fullExport, history: showHistory,
  'history-restore': value => confirmation('Frühere Version wiederherstellen?', `Dein gesamter Studienplan wird auf Version ${value} zurückgesetzt. Der aktuelle Stand bleibt als neue frühere Version verfügbar.`, async () => { const response = await store.request(`history/${value}/restore`, 'POST', { revision: store.revision }); state = response.state; store.revision = response.revision; render(); toast('Version wiederhergestellt'); }),
  templates: showTemplates, 'template-use': useTemplate,
  security: securityDialog,
  'download-recovery': value => download(`Moduly Wiederherstellungscode\nBenutzername: ${store.user?.username}\n\n${value}\n\nPrivat und außerhalb von Moduly aufbewahren.`, 'moduly-wiederherstellung.txt'),
  logout: async () => { await store.logout(); state = emptyState(); adminData = null; showAuth(); toast('Abgemeldet'); },
  'account-delete': () => openDialog('Konto endgültig löschen', `<p class="span-2">Dein Konto und alle zugehörigen persönlichen Einträge werden gelöscht. Diese Aktion kann nicht über die Oberfläche rückgängig gemacht werden.</p>${field('Aktuelles Passwort', 'password', '', 'password', 'required maxlength="128" autocomplete="current-password"')}${check('Ich möchte mein Konto endgültig löschen.', 'confirm')}`, async form => { if (!checked(form, 'confirm')) throw new Error('Bitte bestätige die Kontolöschung.'); await store.request('account', 'DELETE', { password: form.elements.password.value }); store.user = null; store.csrf = ''; state = emptyState(); adminData = null; showAuth(); toast('Dein Konto wurde gelöscht'); }, 'Konto endgültig löschen'),
  report: reportDialog, reports: showReports,
  'admin-refresh': () => { adminData = null; render(); },
  'report-review': value => { const r = adminData.reports.find(r => r.id === value); openDialog('Meldung beantworten', `<p class="span-2 prewrap">${escape(r.message)}</p>${select('Status', 'status', { open: 'Offen', needs_information: 'Weitere Informationen nötig', resolved: 'Bearbeitet' }, r.status)}${area('Antwort an den Nutzer', 'response', r.response)}`, async form => { await store.request(`admin/reports/${value}`, 'POST', { status: val(form, 'status'), response: val(form, 'response') }); await loadAdmin(); toast('Antwort gespeichert'); }); },
  legal,
  'open-menu': () => { document.body.classList.add('sidebar-open'); $('[data-action="open-menu"]').setAttribute('aria-expanded', 'true'); syncMenu(); $('.sidebar-close').focus(); },
  'close-menu': closeMenu, 'close-dialog': closeDialog,
  retry: async () => { await start(); }
};
function moveWidget(key, direction) {
  const enabled = [...document.querySelectorAll('[name="widgets"]:checked')].map(x => x.value);
  const index = widgetOrder.indexOf(key), next = index + direction;
  if (next < 0 || next >= widgetOrder.length) return;
  [widgetOrder[index], widgetOrder[next]] = [widgetOrder[next], widgetOrder[index]];
  $('#widget-order').innerHTML = widgetMarkup();
  document.querySelectorAll('[name="widgets"]').forEach(x => { x.checked = enabled.includes(x.value); });
  $(`[data-action="widget-${direction === 1 ? 'down' : 'up'}"][data-id="${key}"]`).focus();
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button[data-action], a[data-action], [data-action="close-menu"]');
  if (target) {
    event.preventDefault(); const action = actions[target.dataset.action]; if (!action || target.disabled || busy || actionLock || submitting) return;
    actionLock = true;
    try { await action(target.dataset.id); } catch (error) { showError(error, $('#editor[open] .form-error')); }
    finally { actionLock = false; }
  }
  const nav = event.target.closest('[data-page]'); if (nav && !busy && !actionLock && !submitting) navigate(nav.dataset.page);
});
document.addEventListener('submit', async event => {
  const form = event.target; event.preventDefault(); if (busy || actionLock || submitting) return;
  submitting = true;
  const submit = form.querySelector('[type="submit"]'), errorNode = form.querySelector('.form-error');
  if (submit) submit.disabled = true; if (errorNode) errorNode.hidden = true;
  try {
    if (form.id === 'editor-form') { await dialogSave(form); closeDialog(); }
    else if (form.id === 'auth-form') {
      const fields = Object.fromEntries(new FormData(form));
      if (authMode !== 'login' && fields.repeat !== (fields.password || fields.newPassword)) throw new Error('Die Passwörter stimmen nicht überein.');
      delete fields.repeat; const result = await store.authenticate(authMode, fields); await enter(); if (result.recoveryCode) recoveryDialog(result.recoveryCode);
    } else if (form.id === 'export-form') {
      if (store.mode === 'server') { const params = new URLSearchParams(new FormData(form)); for (const key of ['grades', 'attempts', 'notes', 'events', 'open']) params.set(key, checked(form, key) ? 'true' : 'false'); await serverDownload(params); }
      else previewExport(form);
      toast('Export erstellt');
    }
  } catch (error) { showError(error, errorNode); }
  finally { submitting = false; if (submit) submit.disabled = false; }
});
document.addEventListener('change', async event => {
  const input = event.target;
  try {
    if (input.id === 'profile-switch') await mutate(data => { data.settings.activeProfile = input.value; }, 'Studienprofil gewechselt');
    else if (input.dataset.taskToggle) { const value = input.checked; input.disabled = true; try { await mutate(data => { data.tasks.find(t => t.id === input.dataset.taskToggle).done = value; }, value ? 'Ein Schritt geschafft.' : 'Aufgabe wieder geöffnet'); } catch (error) { input.checked = !value; throw error; } finally { input.disabled = false; } }
    else if (input.name === 'status-filter') { filter = input.value; render(); }
    else if (input.name === 'semester-filter') { semester = input.value; render(); }
    else if (input.name === 'event-filter') { filter = input.value; render(); }
    else if (input.name === 'show-past') { showPast = input.checked; render(); }
    else if (input.id === 'import-file') { await importFile(input.files[0]); input.value = ''; }
  } catch (error) { showError(error); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'module-search') {
    query = event.target.value;
    const list = items('modules').filter(m => (!filter || m.status === filter) && (!semester || String(m.semester) === semester) && `${m.name} ${m.code}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, 'de'));
    $('#module-results').innerHTML = list.map(moduleRow).join('') || empty('Keine passenden Module.', 'Passe deine Suche oder Filter an.');
  }
});
$('#editor').addEventListener('cancel', event => { if (closeGuard || busy || submitting || actionLock) event.preventDefault(); });
$('#editor').addEventListener('close', clearDialog);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { closeMenu(); $('[data-action="open-menu"]').focus(); } });
window.addEventListener('hashchange', () => { if (!$('#app').hidden && Object.hasOwn(titles, location.hash.slice(1))) navigate(location.hash.slice(1)); });
window.addEventListener('beforeunload', event => { const dirtyNote = $('#quick-note') && $('#quick-note').value !== state.settings.note; if (busy || submitting || actionLock || closeGuard || dirtyNote) { event.preventDefault(); event.returnValue = ''; } });
async function start() {
  try { await store.connect(); if (store.user) await enter(); else showAuth(); }
  catch (error) { $('#auth-content').innerHTML = `<h2>Verbindung unterbrochen.</h2><p>${escape(error.message)}</p>${primary('Erneut versuchen', 'retry')}`; }
}
start();
matchMedia('(max-width: 820px)').addEventListener('change', syncMenu);
syncMenu();
