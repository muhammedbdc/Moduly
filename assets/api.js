import { emptyState, validateClient } from './domain.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const DB_KEY = 'moduly-local-v1';
const SESSION_KEY = 'moduly-local-session-v1';
const LEGACY_KEY = 'moduly-preview-v1';
const HASH_ITERATIONS = 160000;
const now = () => Math.floor(Date.now() / 1000);

function freshDb() { return { version: 1, users: [], reports: [], audit: [], createdAt: now() }; }
function readDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) return freshDb();
  try {
    const db = JSON.parse(raw);
    if (db?.version !== 1 || !Array.isArray(db.users) || !Array.isArray(db.reports) || !Array.isArray(db.audit)) throw new Error();
    return db;
  } catch { throw new ApiError('Die lokale Moduly-Datenbank ist beschädigt. Stelle eine Sicherung wieder her oder lösche die Browserdaten.', 500); }
}
function writeDb(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch { throw new ApiError('Der Browser konnte nicht speichern. Prüfe freien Speicher und private Browser-Einstellungen.', 507); }
}
function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt, disabled: Boolean(user.disabled), lastBackupAt: user.lastBackupAt || 0 };
}
function randomHex(bytes = 16) {
  const value = new Uint8Array(bytes); crypto.getRandomValues(value);
  return [...value].map(part => part.toString(16).padStart(2, '0')).join('');
}
function recoveryCode() {
  const raw = randomHex(16).toUpperCase();
  return `MODULY-${raw.match(/.{1,8}/g).join('-')}`;
}
async function hashSecret(secret, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: HASH_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return { salt, hash: [...new Uint8Array(bits)].map(part => part.toString(16).padStart(2, '0')).join(''), iterations: HASH_ITERATIONS };
}
async function matches(secret, saved) {
  if (!saved?.salt || !saved?.hash) return false;
  const calculated = await hashSecret(secret, saved.salt);
  if (calculated.hash.length !== saved.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < saved.hash.length; index++) difference |= calculated.hash.charCodeAt(index) ^ saved.hash.charCodeAt(index);
  return difference === 0;
}
function validUsername(value) {
  const username = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new ApiError('Benutzernamen dürfen 3–24 Zeichen lang sein und nur Buchstaben, Zahlen sowie _ enthalten.', 400);
  return username;
}
function validPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) throw new ApiError('Das Passwort muss 12–128 Zeichen lang sein.', 400);
  return password;
}
function hydrateTemplate(input) {
  const base = emptyState(), data = structuredClone(input);
  data.profiles = (data.profiles || []).map(profile => ({ university: '', degree: '', po: '', targetEcts: 210, semesters: 7,
    currentSemester: 1, archived: false, thesisEcts: 0, source: '', ...profile }));
  data.modules = (data.modules || []).map(module => ({ code: '', ects: 5, semester: 1, status: 'open', grade: null,
    attempts: 0, examType: '', duration: 0, materials: '', notes: '', source: '', sourceDate: '', prerequisites: [],
    thesisRequired: false, components: [], edited: true, ...module,
    components: (module.components || []).map(component => ({ weight: 0, grade: null, required: false, passed: false, ...component })) }));
  data.events ||= [];
  data.tasks ||= [];
  data.settings = { ...base.settings, ...(data.settings || {}) };
  return validateClient(data);
}
function cleanHistory(history = []) {
  const cutoff = now() - 30 * 86400;
  return history.filter(item => item.created_at >= cutoff).sort((a, b) => b.revision - a.revision).slice(0, 20);
}

export class Store {
  constructor() { this.mode = null; this.csrf = ''; this.user = null; this.revision = 0; this.meta = {}; }

  async remoteRequest(path, method = 'GET', data) {
    let response;
    try {
      response = await fetch(new URL(`api/${path}`, document.baseURI), { method, credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}) },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    } catch { throw new ApiError('Der Server ist nicht erreichbar.', 0); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(result.error || `Anfrage fehlgeschlagen (${response.status}).`, response.status);
    return result;
  }

  async request(path, method = 'GET', data) {
    if (this.mode === 'local') return this.localRequest(path, method, data);
    return this.remoteRequest(path, method, data);
  }

  async connect() {
    try {
      this.meta = await this.remoteRequest('meta');
      if (this.meta.mode !== 'server') throw new ApiError('Kein Moduly-Server.', 404);
      this.mode = 'server';
      try { this.accept(await this.remoteRequest('me')); } catch (error) { if (error.status !== 401) throw error; }
      return;
    } catch (error) {
      if (![0, 404, 405].includes(error.status)) throw error;
    }
    this.mode = 'local';
    this.meta = { mode: 'local', registration: true, inviteRequired: false, operator: {}, localOnly: true };
    const session = localStorage.getItem(SESSION_KEY), db = readDb(), user = db.users.find(item => item.id === session && !item.disabled);
    if (user) this.user = publicUser(user); else localStorage.removeItem(SESSION_KEY);
  }

  accept(data) { this.user = data.user; if (data.csrf) this.csrf = data.csrf; }

  async authenticate(action, fields) {
    if (this.mode === 'server') {
      const data = await this.remoteRequest(`auth/${action}`, 'POST', fields); this.accept(data); return data;
    }
    const db = readDb(), username = validUsername(fields.username);
    let user = db.users.find(item => item.username.toLocaleLowerCase('de-DE') === username.toLocaleLowerCase('de-DE'));
    if (action === 'register') {
      if (user) throw new ApiError('Dieser Benutzername ist in diesem Browser bereits vergeben.', 409);
      const password = validPassword(fields.password), code = recoveryCode();
      let initialState = emptyState(), legacyRevision = 0;
      if (!db.users.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
          if (legacy?.state) { initialState = validateClient(legacy.state); legacyRevision = Number(legacy.revision) || 0; }
        } catch { /* Eine beschädigte alte Vorschau wird nicht übernommen. */ }
      }
      user = { id: crypto.randomUUID(), username, role: db.users.length ? 'user' : 'owner', disabled: false, createdAt: now(), lastLoginAt: now(), lastBackupAt: 0,
        password: await hashSecret(password), recovery: await hashSecret(code), state: initialState, revision: legacyRevision, history: [] };
      db.users.push(user);
      db.audit.unshift({ id: crypto.randomUUID(), action: `${username} lokal registriert (${user.role})`, created_at: now() });
      writeDb(db); localStorage.setItem(SESSION_KEY, user.id); localStorage.removeItem(LEGACY_KEY);
      this.user = publicUser(user); return { user: this.user, recoveryCode: code };
    }
    if (!user || user.disabled) throw new ApiError('Benutzername oder Passwort ist falsch.', 401);
    if (action === 'login') {
      if (!(await matches(String(fields.password || ''), user.password))) throw new ApiError('Benutzername oder Passwort ist falsch.', 401);
      user.lastLoginAt = now(); writeDb(db); localStorage.setItem(SESSION_KEY, user.id); this.user = publicUser(user); return { user: this.user };
    }
    if (action === 'recover') {
      if (!(await matches(String(fields.recoveryCode || '').trim().toUpperCase(), user.recovery))) throw new ApiError('Benutzername oder Wiederherstellungscode ist falsch.', 401);
      const code = recoveryCode(); user.password = await hashSecret(validPassword(fields.newPassword)); user.recovery = await hashSecret(code); user.lastLoginAt = now();
      db.audit.unshift({ id: crypto.randomUUID(), action: `Wiederherstellungscode von ${user.username} erneuert`, created_at: now() });
      writeDb(db); localStorage.setItem(SESSION_KEY, user.id); this.user = publicUser(user); return { user: this.user, recoveryCode: code };
    }
    throw new ApiError('Unbekannte Anmeldeaktion.', 400);
  }

  current(db = readDb()) {
    const user = db.users.find(item => item.id === this.user?.id && !item.disabled);
    if (!user) { this.user = null; localStorage.removeItem(SESSION_KEY); throw new ApiError('Das lokale Konto ist nicht mehr verfügbar.', 401); }
    return user;
  }

  async load() {
    if (this.mode === 'server') {
      const data = await this.remoteRequest('state'); this.revision = data.revision; return data.state;
    }
    const user = this.current(); this.revision = user.revision || 0; return validateClient(user.state || emptyState());
  }

  async save(state) {
    const clean = validateClient(state);
    if (this.mode === 'server') {
      const data = await this.remoteRequest('state', 'PUT', { state: clean, revision: this.revision }); this.revision = data.revision; return data.state;
    }
    const db = readDb(), user = this.current(db);
    if ((user.revision || 0) !== this.revision) throw new ApiError('Die Daten wurden in einem anderen Tab geändert. Bitte neu laden.', 409);
    user.history = cleanHistory([{ revision: user.revision || 0, state: user.state || emptyState(), created_at: now() }, ...(user.history || [])]);
    user.state = clean; user.revision = (user.revision || 0) + 1; this.revision = user.revision; writeDb(db); return clean;
  }

  backupInfo() {
    if (this.mode !== 'local' || !this.user) return null;
    const db = readDb(), user = this.current(db), ageDays = user.lastBackupAt ? Math.floor((now() - user.lastBackupAt) / 86400) : null;
    return { lastBackupAt: user.lastBackupAt || 0, ageDays, due: ageDays === null || ageDays >= 7, storageBytes: new Blob([JSON.stringify(db)]).size };
  }

  noteBackup() {
    if (this.mode !== 'local' || !this.user) return;
    const db = readDb(), user = this.current(db); user.lastBackupAt = now(); writeDb(db); this.user = publicUser(user);
  }

  requireAdmin(db) {
    const user = this.current(db);
    if (!['admin', 'owner'].includes(user.role)) throw new ApiError('Keine Berechtigung.', 403);
    return user;
  }

  async localRequest(path, method = 'GET', data = {}) {
    if (path === 'templates' && method === 'GET') {
      const response = await fetch(new URL('catalog/v1.json', document.baseURI), { cache: 'no-store' });
      if (!response.ok) throw new ApiError('Studienvorlagen konnten nicht geladen werden.', response.status);
      const result = await response.json(); result.templates = (result.templates || []).map(template => ({ ...template, data: hydrateTemplate(template.data) })); return result;
    }
    const db = readDb(), user = this.current(db);
    if (path === 'history' && method === 'GET') {
      user.history = cleanHistory(user.history); writeDb(db); return { history: user.history.map(({ revision, created_at }) => ({ revision, created_at })) };
    }
    const restore = path.match(/^history\/(\d+)\/restore$/);
    if (restore && method === 'POST') {
      if (Number(data.revision) !== Number(user.revision)) throw new ApiError('Die Daten wurden zwischenzeitlich geändert.', 409);
      const selected = cleanHistory(user.history).find(item => item.revision === Number(restore[1]));
      if (!selected) throw new ApiError('Diese frühere Version ist nicht mehr verfügbar.', 404);
      user.history = cleanHistory([{ revision: user.revision, state: user.state, created_at: now() }, ...user.history]);
      user.state = validateClient(selected.state); user.revision += 1; writeDb(db); this.revision = user.revision;
      return { state: user.state, revision: user.revision };
    }
    if (path === 'reports') {
      if (method === 'GET') return { reports: db.reports.filter(item => item.userId === user.id).sort((a, b) => b.created_at - a.created_at) };
      const message = String(data.message || '').trim(), category = String(data.category || 'technical');
      if (!message || message.length > 4000) throw new ApiError('Die Beschreibung fehlt oder ist zu lang.', 400);
      if (!['technical', 'study', 'privacy'].includes(category)) throw new ApiError('Ungültige Kategorie.', 400);
      db.reports.push({ id: crypto.randomUUID(), userId: user.id, category, message, status: 'open', response: '', created_at: now() }); writeDb(db); return { ok: true };
    }
    if (path === 'account/security' && method === 'POST') {
      if (!(await matches(String(data.password || ''), user.password))) throw new ApiError('Das aktuelle Passwort ist falsch.', 401);
      let code;
      if (data.action === 'username') {
        const username = validUsername(data.username);
        if (db.users.some(item => item.id !== user.id && item.username.toLowerCase() === username.toLowerCase())) throw new ApiError('Dieser Benutzername ist bereits vergeben.', 409);
        user.username = username;
      } else if (data.action === 'password') user.password = await hashSecret(validPassword(data.newPassword));
      else if (data.action === 'recovery') { code = recoveryCode(); user.recovery = await hashSecret(code); }
      else if (data.action !== 'sessions') throw new ApiError('Unbekannte Sicherheitsaktion.', 400);
      db.audit.unshift({ id: crypto.randomUUID(), action: `Kontosicherheit von ${user.username} geändert`, created_at: now() }); writeDb(db);
      this.user = publicUser(user); return { ok: true, user: this.user, recoveryCode: code };
    }
    if (path === 'account' && method === 'DELETE') {
      if (!(await matches(String(data.password || ''), user.password))) throw new ApiError('Das aktuelle Passwort ist falsch.', 401);
      if (user.role === 'owner' && db.users.filter(item => item.role === 'owner' && item.id !== user.id).length === 0 && db.users.length > 1) throw new ApiError('Übertrage zuerst einem anderen lokalen Konto die Owner-Rolle.', 409);
      db.users = db.users.filter(item => item.id !== user.id); db.reports = db.reports.filter(item => item.userId !== user.id);
      db.audit.unshift({ id: crypto.randomUUID(), action: `Lokales Konto ${user.username} gelöscht`, created_at: now() }); writeDb(db);
      localStorage.removeItem(SESSION_KEY); this.user = null; return { ok: true };
    }
    if (path === 'admin' && method === 'GET') {
      this.requireAdmin(db);
      const allReports = db.reports.slice().sort((a, b) => b.created_at - a.created_at).map(item => ({ ...item, username: db.users.find(u => u.id === item.userId)?.username || 'Gelöschtes Konto' }));
      const lastBackup = db.users.reduce((latest, item) => Math.max(latest, item.lastBackupAt || 0), 0);
      return { users: db.users.length, userList: db.users.map(publicUser), reports: allReports, database: 'Lokaler Browserspeicher',
        backup: lastBackup ? { ok: true, verifiedAt: lastBackup } : null, audit: db.audit.slice(0, 100), storageBytes: new Blob([JSON.stringify(db)]).size };
    }
    const report = path.match(/^admin\/reports\/([^/]+)$/);
    if (report && method === 'POST') {
      const admin = this.requireAdmin(db), entry = db.reports.find(item => item.id === report[1]);
      if (!entry) throw new ApiError('Meldung nicht gefunden.', 404);
      if (!['open', 'needs_information', 'resolved'].includes(data.status)) throw new ApiError('Ungültiger Status.', 400);
      entry.status = data.status; entry.response = String(data.response || '').trim().slice(0, 4000);
      db.audit.unshift({ id: crypto.randomUUID(), action: `${admin.username} bearbeitete eine lokale Meldung`, created_at: now() }); writeDb(db); return { ok: true };
    }
    const adminUser = path.match(/^admin\/users\/([^/]+)$/);
    if (adminUser && method === 'POST') {
      const admin = this.requireAdmin(db), target = db.users.find(item => item.id === adminUser[1]);
      if (!target) throw new ApiError('Konto nicht gefunden.', 404);
      if (data.action === 'role') {
        if (admin.role !== 'owner') throw new ApiError('Nur Owner dürfen Rollen vergeben.', 403);
        if (!['user', 'admin', 'owner'].includes(data.role)) throw new ApiError('Ungültige Rolle.', 400);
        if (target.id === admin.id && data.role !== 'owner') throw new ApiError('Du kannst deine eigene Owner-Rolle nicht herabstufen.', 409);
        target.role = data.role;
      } else if (data.action === 'toggle') {
        if (target.id === admin.id) throw new ApiError('Du kannst dein eigenes Konto nicht sperren.', 409);
        target.disabled = !target.disabled;
      } else throw new ApiError('Unbekannte Verwaltungsaktion.', 400);
      db.audit.unshift({ id: crypto.randomUUID(), action: `${admin.username} änderte das lokale Konto ${target.username}`, created_at: now() }); writeDb(db); return { ok: true };
    }
    if (adminUser && method === 'DELETE') {
      const admin = this.requireAdmin(db), target = db.users.find(item => item.id === adminUser[1]);
      if (!target) throw new ApiError('Konto nicht gefunden.', 404);
      if (target.id === admin.id || target.role === 'owner') throw new ApiError('Dieses Konto kann hier nicht gelöscht werden.', 409);
      db.users = db.users.filter(item => item.id !== target.id); db.reports = db.reports.filter(item => item.userId !== target.id);
      db.audit.unshift({ id: crypto.randomUUID(), action: `${admin.username} löschte das lokale Konto ${target.username}`, created_at: now() }); writeDb(db); return { ok: true };
    }
    throw new ApiError('Lokale Funktion nicht gefunden.', 404);
  }

  async logout() {
    if (this.mode === 'server') await this.remoteRequest('auth/logout', 'POST', {});
    else localStorage.removeItem(SESSION_KEY);
    this.user = null; this.csrf = '';
  }
}
