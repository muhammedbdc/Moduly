import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// DOM integration, not a screenshot or a browser-rendering test.
test('local app: account, profile, modules, exam, task, admin and backup', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const catalog = await readFile(new URL('../catalog/v1.json', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.org/Moduly/', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ['document', 'location', 'history', 'localStorage', 'FormData']) globalThis[key] = window[key];
  globalThis.window = window;
  globalThis.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion: reduce'), addEventListener() {} });
  globalThis.fetch = async input => String(input).includes('catalog/v1.json')
    ? new Response(catalog, { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.HTMLAnchorElement.prototype.click = function () {};
  let downloaded;
  URL.createObjectURL = blob => { downloaded = blob; return 'blob:moduly-test'; };
  URL.revokeObjectURL = () => {};
  const $ = selector => document.querySelector(selector);
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.fail('UI did not reach the expected state: ' + $('#toast').textContent + ' / ' + ($('.form-error:not([hidden])')?.textContent || ''));
  };
  const click = async selector => { assert.ok($(selector), 'Missing element ' + selector); $(selector).click(); await new Promise(resolve => setTimeout(resolve, 0)); };
  const fill = (name, value) => { const input = $(`#editor [name="${name}"]`); assert.ok(input, name); input.value = value; };
  const submit = async () => { $('#editor-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await wait(() => !$('#editor').open); };
  const saved = () => {
    const db = JSON.parse(localStorage.getItem('moduly-local-v1'));
    return db.users.find(user => user.id === localStorage.getItem('moduly-local-session-v1')).state;
  };

  await import('../assets/app.js');
  await wait(() => $('#auth-form'));
  assert.ok($('.login-button')); assert.ok($('.create-button')); assert.ok($('.reveal-button'));
  await click('[data-action="auth-mode"][data-id="register"]');
  const testPassword = `Test-only-${crypto.randomUUID()}!`;
  $('#auth-form [name="username"]').value = 'owner_test';
  $('#auth-form [name="password"]').value = testPassword;
  $('#auth-form [name="repeat"]').value = testPassword;
  $('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => !$('#app').hidden && $('#editor').open);
  assert.match($('.recovery-code').textContent, /^MODULY-/);
  $('[name="saved"]').checked = true; await submit();
  assert.ok($('.logout-button'));
  assert.equal($('#admin-nav').hidden, false);
  assert.ok($('#preview-notice').textContent.includes('Nur lokal gespeichert'));
  assert.equal(document.querySelectorAll('#university-catalog option').length, 3);
  await click('[data-action="templates"]'); await wait(() => $('#editor').open && $('#dialog-content').textContent.includes('Internationaler Studiengang Wirtschaftsingenieurwesen'));
  assert.ok($('#dialog-content').textContent.includes('Jade Hochschule'));
  assert.ok($('#dialog-content').textContent.includes('Universität Bremen'));
  await click('[data-action="template-use"]'); await wait(() => !$('#editor').open && saved().modules.length === 32);
  assert.equal(saved().profiles[0].targetEcts, 210);
  assert.equal(saved().modules.reduce((sum, module) => sum + module.ects, 0), 210);
  await click('[data-page="settings"]'); await click('[data-action="profile-delete"]'); $('[name="confirm"]').checked = true; await submit();
  assert.equal(saved().profiles.length, 0);
  await click('[data-action="profile-new"]'); assert.ok($('#editor-form .create-button')); fill('name', 'Mein Teststudium'); fill('university', 'Selbst angelegt'); await submit();
  assert.equal(saved().profiles[0].name, 'Mein Teststudium');
  await click('[data-page="study"]');
  await click('[data-action="module-new"]'); fill('name', '<script>Kein HTML</script>'); fill('status', 'passed'); fill('grade', '1.7'); fill('attempts', '1'); await submit();
  assert.equal(saved().modules.length, 1); assert.equal(saved().modules[0].grade, 1.7);
  assert.ok($('#main-content').textContent.includes('<script>Kein HTML</script>'));
  assert.equal($('#main-content script'), null);
  await click('[data-page="overview"]');
  assert.ok($('#main-content').textContent.includes('5 von 180 ECTS'));

  await click('[data-page="exams"]'); await click('#main-content [data-action="event-new"]'); fill('title', 'Meine Prüfung'); fill('start', '2027-06-15T10:00'); fill('timezone', 'Europe/Berlin'); $('[name="reminders"][value="120"]').checked = true; await submit();
  assert.equal(saved().events[0].title, 'Meine Prüfung');
  assert.deepEqual(saved().events[0].reminders, [10080, 1440, 120]);
  await click('[data-action="event-export"]'); await wait(() => downloaded); assert.match(await downloaded.text(), /DTSTART:20270615T080000Z/);
  await click('[data-page="calendar"]'); assert.equal(document.querySelectorAll('.weekday').length, 7); await click('[data-action="month"][data-id="1"]');

  await click('[data-page="planning"]'); await click('#main-content [data-action="task-new"]'); fill('title', 'Ein Kapitel lesen'); fill('minutes', '45'); await submit();
  await click('[data-task-toggle]'); await wait(() => saved().tasks[0].done); assert.ok($('#main-content').textContent.includes('1 von 1 Aufgaben erledigt'));
  await click('[data-action="customize"]'); const notes = $('[name="widgets"][value="note"]'); notes.checked = false; await submit();
  assert.ok(!saved().settings.widgets.includes('note'));
  await click('[data-page="settings"]'); await click('[data-action="theme"]'); await wait(() => document.documentElement.dataset.theme === 'dark');
  await click('[data-page="export"]'); downloaded = null; await click('[data-action="json-export"]'); await wait(() => downloaded); const archive = JSON.parse(await downloaded.text());
  assert.equal(archive.format, 'moduly'); assert.equal(archive.state.modules.length, 1);
  assert.ok(JSON.parse(localStorage.getItem('moduly-local-v1')).users[0].lastBackupAt > 0);
  await click('[data-page="admin"]'); await wait(() => $('#main-content').textContent.includes('Lokaler Adminbereich'));
  assert.ok($('#main-content').textContent.includes('owner_test'));
  await click('[data-page="study"]'); await click('[data-action="module-delete"]'); assert.ok($('#editor-form .delete-action')); $('[name="confirm"]').checked = true; await submit();
  assert.equal(saved().modules.length, 0); assert.equal(saved().events.length, 1);
  await click('[data-action="legal"][data-id="privacy"]'); assert.ok($('#dialog-content').textContent.includes('lokalen Speicher')); await click('[data-action="close-dialog"]');
  assert.equal($('#dialog-content').textContent, '');
  await click('[data-action="logout"]');
  assert.equal($('#app').hidden, true); assert.equal($('#main-content').textContent, ''); assert.equal($('#username').textContent, '');
  dom.window.close();
});
