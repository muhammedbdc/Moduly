import test from 'node:test';
import assert from 'node:assert/strict';
import { demoState, validateClient, summary, removeModule, removeProfile, calendar, eventInstant } from '../assets/domain.js';

test('ECTS are counted per module; grades are weighted, ungraded modules excluded', () => {
  const data = demoState(), pid = data.profiles[0].id;
  const stats = summary(data, pid);
  assert.equal(stats.ects, 10); assert.equal(stats.passed, 2); assert.equal(stats.average, 2);
  data.modules[0].grade = null;
  assert.equal(summary(data, pid).average, 1.7);
});
test('module removal preserves events and clears dependency references', () => {
  const data = demoState(), ref = data.modules[2].id;
  data.modules[3].prerequisites = [ref];
  removeModule(data, ref);
  assert.equal(data.events.length, 1); assert.equal(data.events[0].moduleId, '');
  assert.deepEqual(data.modules[2].prerequisites, []); validateClient(data);
});
test('profile deletion removes only the matching profile and its rows', () => {
  const data = demoState(); data.profiles.push({ ...data.profiles[0], id: 'other' });
  removeProfile(data, data.profiles[0].id);
  assert.equal(data.profiles.length, 1); assert.equal(data.settings.activeProfile, 'other');
  assert.equal(data.modules.length, 0); assert.equal(data.events.length, 0); assert.equal(data.tasks.length, 0);
});
test('invalid imports cannot inject duplicates, grades, sources or prerequisite cycles', () => {
  for (const change of [d => { d.modules[0].ects = NaN; }, d => { d.modules.push(d.modules[0]); }, d => { d.modules[0].grade = 5; }, d => { d.modules[0].source = 'javascript:alert(1)'; }, d => { d.modules[0].prerequisites = [d.modules[1].id]; d.modules[1].prerequisites = [d.modules[0].id]; }]) {
    const data = demoState(); change(data); assert.throws(() => validateClient(data));
  }
});
test('calendar and countdown agree on summer time, winter time and autumn fold', () => {
  const data = demoState(), event = data.events[0]; event.timezone = 'Europe/Berlin';
  event.start = '2026-10-25T02:30';
  assert.equal(new Date(eventInstant(event)).toISOString(), '2026-10-25T00:30:00.000Z');
  assert.match(calendar([event], data.modules), /DTSTART:20261025T003000Z/);
  event.start = '2026-01-15T09:00'; assert.equal(new Date(eventInstant(event)).getUTCHours(), 8);
  event.start = '2026-07-15T09:00'; assert.equal(new Date(eventInstant(event)).getUTCHours(), 7);
  event.start = '2026-03-29T02:30'; assert.ok(Number.isNaN(eventInstant(event))); assert.throws(() => validateClient(data));
  event.start = '2026-02-31T09:00'; assert.ok(Number.isNaN(eventInstant(event)));
  event.timezone = 'Australia/Lord_Howe'; event.start = '2026-04-05T01:45';
  assert.equal(new Date(eventInstant(event)).toISOString(), '2026-04-04T14:45:00.000Z');
});
test('calendar UTF-8 line folding and escaping prevent extra injected events', () => {
  const data = demoState(); data.events[0].title = 'ü'.repeat(100) + '\nBEGIN:VEVENT';
  const result = calendar(data.events, data.modules);
  assert.equal((result.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 1);
  assert.ok(result.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
});
