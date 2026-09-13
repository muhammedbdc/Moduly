import { emptyState, validateClient } from './domain.js';
export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
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
export class Store {
  constructor() { this.mode = null; this.csrf = ''; this.user = null; this.revision = 0; this.meta = {}; }
  async request(path, method = 'GET', data) {
    let response;
    const previewCatalog = this.mode === 'preview' && path === 'templates' && method === 'GET';
    try { response = await fetch(new URL(previewCatalog ? 'catalog/v1.json' : `api/${path}`, document.baseURI), { method, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }); }
    catch { throw new ApiError('Der Server ist nicht erreichbar. Deine Eingabe bleibt geöffnet; bitte Verbindung prüfen.', 0); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(result.error || `Anfrage fehlgeschlagen (${response.status}).`, response.status);
    if (previewCatalog) result.templates = (result.templates || []).map(template => ({ ...template, data: hydrateTemplate(template.data) }));
    return result;
  }
  async connect() {
    try { this.meta = await this.request('meta'); if (this.meta.mode !== 'server') throw new ApiError('Kein Moduly-Server.', 404); this.mode = 'server'; }
    catch (error) { if ([404, 405].includes(error.status)) { this.mode = 'preview'; return; } throw error; }
    try { this.accept(await this.request('me')); } catch (error) { if (error.status !== 401) throw error; }
  }
  accept(data) { this.user = data.user; if (data.csrf) this.csrf = data.csrf; }
  async authenticate(action, fields) {
    if (this.mode !== 'server') throw new ApiError('Konten sind erst auf dem Moduly-Server verfügbar.', 400);
    const data = await this.request(`auth/${action}`, 'POST', fields); this.accept(data); return data;
  }
  async load() {
    if (this.mode === 'preview') {
      const raw = localStorage.getItem('moduly-preview-v1');
      if (!raw) { this.revision = 0; return emptyState(); }
      let data; try { data = JSON.parse(raw); } catch { throw new ApiError('Die lokale Vorschau ist beschädigt. Über „Vorschau zurücksetzen“ kannst du neu beginnen.', 400); }
      this.revision = data.revision || 0; return validateClient(data.state);
    }
    const data = await this.request('state'); this.revision = data.revision; return data.state;
  }
  async save(state) {
    const clean = validateClient(state);
    if (this.mode === 'preview') {
      const current = JSON.parse(localStorage.getItem('moduly-preview-v1') || 'null');
      if (current && current.revision !== this.revision) throw new ApiError('Die Vorschau wurde in einem anderen Tab geändert. Bitte neu laden.', 409);
      try { localStorage.setItem('moduly-preview-v1', JSON.stringify({ state: clean, revision: this.revision + 1 })); }
      catch { throw new ApiError('Der Browser konnte nicht speichern. Speicherplatz oder private Browser-Einstellungen prüfen.', 507); }
      this.revision++; return clean;
    }
    const data = await this.request('state', 'PUT', { state: clean, revision: this.revision }); this.revision = data.revision; return data.state;
  }
  async logout() { if (this.mode === 'server') await this.request('auth/logout', 'POST', {}); this.user = null; this.csrf = ''; }
}
