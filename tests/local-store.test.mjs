import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Store } from '../assets/api.js';
import { emptyState } from '../assets/domain.js';

test('local store separates accounts, enforces unique names and provides admin controls', async () => {
  const dom = new JSDOM('<!doctype html><base href="https://example.org/Moduly/">', { url: 'https://example.org/Moduly/' });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.fetch = async () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });

  const ownerStore = new Store();
  await ownerStore.connect();
  assert.equal(ownerStore.mode, 'local');
  const ownerPassword = `Test-only-${crypto.randomUUID()}!`;
  const friendPassword = `Test-only-${crypto.randomUUID()}!`;
  const ownerResult = await ownerStore.authenticate('register', { username: 'owner_test', password: ownerPassword });
  assert.equal(ownerResult.user.role, 'owner');
  assert.match(ownerResult.recoveryCode, /^MODULY-/);

  const ownerState = emptyState();
  ownerState.profiles.push({ id: 'profil-1', name: 'ISWI', university: 'Hochschule Bremen', degree: 'B.Eng.', po: '2025', targetEcts: 210, semesters: 7, currentSemester: 1, archived: false, thesisEcts: 0, source: '' });
  ownerState.settings.activeProfile = 'profil-1';
  await ownerStore.save(ownerState);
  assert.equal((await ownerStore.request('history')).history.length, 1);
  ownerStore.noteBackup();
  assert.equal(ownerStore.backupInfo().due, false);
  await ownerStore.logout();

  const friendStore = new Store();
  await friendStore.connect();
  const friend = await friendStore.authenticate('register', { username: 'friend_test', password: friendPassword });
  assert.equal(friend.user.role, 'user');
  assert.equal((await friendStore.load()).profiles.length, 0);
  await friendStore.request('reports', 'POST', { category: 'technical', message: 'Testmeldung' });
  await friendStore.logout();

  await assert.rejects(
    () => friendStore.authenticate('register', { username: 'FRIEND_TEST', password: `Test-only-${crypto.randomUUID()}!` }),
    /bereits vergeben/
  );

  await ownerStore.authenticate('login', { username: 'owner_test', password: ownerPassword });
  const admin = await ownerStore.request('admin');
  assert.equal(admin.users, 2);
  assert.equal(admin.reports[0].username, 'friend_test');
  const friendId = admin.userList.find(user => user.username === 'friend_test').id;
  await ownerStore.request(`admin/users/${friendId}`, 'POST', { action: 'role', role: 'admin' });
  assert.equal((await ownerStore.request('admin')).userList.find(user => user.id === friendId).role, 'admin');

  dom.window.close();
});
