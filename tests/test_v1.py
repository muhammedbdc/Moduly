import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet, InvalidToken

from server.app import create_app, connect, password_matches
from server.exports import calendar, export
from server.manage import backup, restore, verify
from server.model import Invalid, empty_state, summary, validate

PASSWORD = 'Ein-langes-Passwort-2026!'
ORIGIN = 'http://localhost:8000'


def sample():
    data = empty_state()
    data['profiles'] = [{'id': 'degree-1', 'name': 'Mein Studiengang', 'targetEcts': 180}]
    data['modules'] = [
        {'id': 'math', 'profileId': 'degree-1', 'name': 'Mathematik', 'ects': 5, 'status': 'passed', 'grade': 2.0, 'attempts': 1},
        {'id': 'project', 'profileId': 'degree-1', 'name': 'Projekt', 'ects': 10, 'status': 'passed', 'grade': 1.0, 'attempts': 1},
        {'id': 'lab', 'profileId': 'degree-1', 'name': 'Labor', 'ects': 5, 'status': 'passed'},
        {'id': 'next', 'profileId': 'degree-1', 'name': 'Mathematik II', 'ects': 5, 'prerequisites': ['math']},
    ]
    data['events'] = [{'id': 'exam-1', 'profileId': 'degree-1', 'moduleId': 'next', 'title': 'Prüfung, Teil 1', 'start': '2026-10-25T02:30', 'timezone': 'Europe/Berlin', 'duration': 90, 'reminders': [10080, 1440, 120]}]
    data['tasks'] = [{'id': 'task-1', 'profileId': 'degree-1', 'title': 'Lernen', 'due': '2026-10-24'}]
    data['settings']['activeProfile'] = 'degree-1'
    return validate(data)


class ModelTests(unittest.TestCase):
    def test_ects_count_modules_once_and_weighted_grade_excludes_ungraded(self):
        data = sample()
        data['modules'][0]['components'] = [
            {'id': 'c1', 'name': 'Klausur', 'weight': 70, 'grade': 2, 'required': True, 'passed': True},
            {'id': 'c2', 'name': 'Präsentation', 'weight': 30, 'grade': 2, 'required': True, 'passed': True}]
        stats = summary(validate(data), 'degree-1')
        self.assertEqual(stats['ects'], 20)
        self.assertEqual(stats['average'], 1.33)
        self.assertEqual(stats['passed'], 3)

    def test_rejects_cross_profile_reference_and_cycles(self):
        for change in ('foreign', 'cycle', 'self'):
            with self.subTest(change=change):
                data = sample()
                data['modules'][0]['prerequisites'] = [{'foreign': 'unknown', 'cycle': 'next', 'self': 'math'}[change]]
                with self.assertRaises(Invalid):
                    validate(data)

    def test_long_chain_does_not_overflow_stack(self):
        data = sample()
        data['events'] = []
        data['modules'] = [{'id': f'm{i}', 'profileId': 'degree-1', 'name': str(i), 'prerequisites': [f'm{i-1}'] if i else []} for i in range(1000)]
        self.assertEqual(len(validate(data)['modules']), 1000)

    def test_rejects_invalid_grade_and_incomplete_required_component(self):
        data = sample()
        data['modules'][0]['grade'] = 5
        with self.assertRaises(Invalid): validate(data)
        data = sample()
        data['modules'][0]['components'] = [{'id': 'c1', 'name': 'Pflichtlabor', 'required': True, 'passed': False}]
        with self.assertRaises(Invalid): validate(data)

    def test_rejects_nan_duplicate_ids_unsafe_links_and_bad_types(self):
        cases = [lambda d: d['modules'][0].update(ects=float('nan')), lambda d: d['modules'].append(d['modules'][0]),
            lambda d: d['profiles'][0].update(source='javascript:alert(1)'), lambda d: d['modules'][0].update(profileId=[]),
            lambda d: d['events'][0].update(moduleId=[]), lambda d: d['events'][0].update(reminders=[60]),
            lambda d: d['settings'].update(activeProfile={})]
        for change in cases:
            data = sample(); change(data)
            with self.assertRaises(Invalid): validate(data)

    def test_dst_gap_rejected_and_fold_exported_as_utc(self):
        data = sample()
        ics = calendar(data['events'], data['modules'])
        self.assertIn(b'DTSTART:20261025T003000Z', ics)
        self.assertIn(b'DTEND:20261025T020000Z', ics)
        self.assertIn(b'TRIGGER:-P7D', ics)
        self.assertIn(b'TRIGGER:-P1D', ics)
        self.assertIn(b'TRIGGER:-PT2H', ics)
        data['events'][0]['start'] = '2026-03-29T02:30'
        with self.assertRaises(Invalid): validate(data)

    def test_calendar_folds_utf8_and_escapes_injected_lines(self):
        data = sample(); data['events'][0]['title'] = 'ü' * 100 + '\nBEGIN:VEVENT'
        ics = calendar(data['events'], data['modules'])
        self.assertEqual(ics.count(b'\r\nBEGIN:VEVENT\r\n'), 1)
        self.assertTrue(all(len(line) <= 75 for line in ics.split(b'\r\n')))
        ics.decode('utf-8')

    def test_export_filters_and_csv_formula_neutralization(self):
        data = sample(); data['modules'][0]['name'] = '=HYPERLINK("https://example.org")'; data['modules'][0]['notes'] = 'Privat'
        csv, _, _ = export(data, 'csv', options={'notes': False, 'grades': False})
        self.assertIn(b"'=HYPERLINK", csv)
        self.assertNotIn(b'Privat', csv)
        pdf, mimetype, _ = export(data, 'pdf')
        self.assertEqual(mimetype, 'application/pdf')
        self.assertTrue(pdf.startswith(b'%PDF'))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.config = {'TESTING': True, 'DATA_DIR': self.directory, 'DATABASE': self.directory / 'test.sqlite3', 'JOURNAL': self.directory / 'deletions.jsonl', 'ORIGIN': ORIGIN, 'PRODUCTION': False,
            # Test fixtures must not inherit the deployment smoke test's closed registration.
            'REGISTRATION': True, 'INVITE_CODE': ''}
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temporary.cleanup()

    def register(self, client=None, name='Alice'):
        client = client or self.client
        response = client.post('/api/auth/register', json={'username': name, 'password': PASSWORD}, headers={'Origin': ORIGIN})
        self.assertEqual(response.status_code, 200, response.json)
        client.csrf = response.json['csrf']
        return response

    def write(self, path, data, method='POST', client=None):
        client = client or self.client
        return client.open(path, method=method, json=data, headers={'Origin': ORIGIN, 'X-CSRF-Token': getattr(client, 'csrf', '')})

    def save(self, data, revision=0, client=None):
        return self.write('/api/state', {'state': data, 'revision': revision}, 'PUT', client)

    def test_registration_unique_case_insensitive_and_no_email(self):
        response = self.register()
        self.assertIn('HttpOnly', response.headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', response.headers['Set-Cookie'])
        duplicate = self.client.post('/api/auth/register', json={'username': 'aLiCe', 'password': PASSWORD}, headers={'Origin': ORIGIN})
        self.assertEqual(duplicate.status_code, 409)
        connection = connect(self.config['DATABASE'])
        row = connection.execute('SELECT * FROM users').fetchone(); connection.close()
        self.assertNotEqual(row['password_hash'], PASSWORD)
        self.assertTrue(password_matches(PASSWORD, row['password_hash']))
        self.assertNotEqual(row['recovery_hash'], response.json['recoveryCode'])
        self.assertNotIn('email', dict(row))

    def test_checked_catalog_contains_named_universities_and_complete_iswi_plan(self):
        public = self.client.get('/catalog/v1.json')
        self.assertEqual(public.status_code, 200)
        self.assertEqual({u['name'] for u in public.json['universities']}, {'Hochschule Bremen', 'Jade Hochschule', 'Universität Bremen'})
        self.register()
        response = self.client.get('/api/templates')
        self.assertEqual(response.status_code, 200)
        template = next(t for t in response.json['templates'] if t['id'] == 'hsb-iswi-beng-po-2025')
        self.assertEqual(template['data']['profiles'][0]['targetEcts'], 210)
        self.assertEqual(template['data']['profiles'][0]['semesters'], 7)
        self.assertEqual(len(template['data']['modules']), 32)
        self.assertEqual(sum(module['ects'] for module in template['data']['modules']), 210)
        self.assertEqual({semester: sum(m['ects'] for m in template['data']['modules'] if m['semester'] == semester) for semester in range(1, 8)}, {semester: 30 for semester in range(1, 8)})
        self.assertTrue(all(module['status'] == 'open' and module['source'] for module in template['data']['modules']))

    def test_anonymous_and_cross_origin_requests_are_rejected(self):
        self.assertEqual(self.client.get('/api/state').status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.register()
        self.assertEqual(self.client.put('/api/state', json={}, headers={'Origin': ORIGIN}).status_code, 403)
        self.assertEqual(self.client.post('/api/auth/logout', json={}, headers={'Origin': 'https://evil.example', 'X-CSRF-Token': self.client.csrf}).status_code, 403)

    def test_private_workspace_export_history_and_reports_are_scoped(self):
        self.register()
        bob = self.app.test_client(); self.register(bob, 'Bob')
        alice_state = sample(); alice_state['settings']['note'] = 'ALICE_PRIVATE'
        bob_state = sample(); bob_state['profiles'][0]['id'] = 'bob-degree'
        for key in ('modules', 'events', 'tasks'):
            for row in bob_state[key]: row['profileId'] = 'bob-degree'
        bob_state['settings'].update(activeProfile='bob-degree', note='BOB_SECRET')
        self.assertEqual(self.save(alice_state).status_code, 200)
        self.assertEqual(self.save(bob_state, client=bob).status_code, 200)
        self.write('/api/reports', {'category': 'technical', 'message': 'Bob private issue'}, client=bob)
        alice_id = self.client.get('/api/me').json['user']['id']
        bob_id = bob.get('/api/me').json['user']['id']
        for url in ('/api/state', '/api/export?format=json', '/api/reports'):
            response = self.client.get(url + ('&' if '?' in url else '?') + 'user_id=' + bob_id)
            self.assertNotIn(b'BOB_SECRET', response.data)
            self.assertNotIn(b'Bob private issue', response.data)
        self.assertEqual(self.client.get('/api/export?format=json&profile=bob-degree').status_code, 404)
        self.assertEqual(self.write('/api/history/0/restore', {'revision': 1}).status_code, 200)
        self.assertEqual(self.client.get('/api/state').json['state']['profiles'], [])
        self.assertEqual(bob.get('/api/state').json['state']['settings']['note'], 'BOB_SECRET')

    def test_optimistic_updates_never_overwrite_a_newer_version(self):
        self.register(); self.assertEqual(self.save(sample()).status_code, 200)
        stale = sample(); stale['settings']['note'] = 'stale'
        self.assertEqual(self.save(stale).status_code, 409)
        self.assertEqual(self.client.get('/api/state').json['revision'], 1)
        self.assertEqual(self.client.get('/api/state').json['state']['settings']['note'], '')

    def test_client_cannot_assign_roles_or_read_admin_data(self):
        self.register()
        data = sample(); data['role'] = 'owner'; data['user_id'] = 'someone-else'
        self.assertEqual(self.save(data).status_code, 200)
        self.assertEqual(self.client.get('/api/me').json['user']['role'], 'user')
        self.assertEqual(self.client.get('/api/admin').status_code, 403)
        self.assertNotIn('role', self.client.get('/api/state').json['state'])

    def test_recovery_rotates_code_and_revokes_existing_sessions(self):
        code = self.register().json['recoveryCode']
        other = self.app.test_client()
        recovered = other.post('/api/auth/recover', json={'username': 'alice', 'recoveryCode': code, 'newPassword': PASSWORD + 'NEW'}, headers={'Origin': ORIGIN})
        self.assertEqual(recovered.status_code, 200)
        self.assertNotEqual(recovered.json['recoveryCode'], code)
        self.assertEqual(self.client.get('/api/state').status_code, 401)
        replay = self.client.post('/api/auth/recover', json={'username': 'alice', 'recoveryCode': code, 'newPassword': PASSWORD}, headers={'Origin': ORIGIN})
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(other.get('/api/state').status_code, 200)

    def test_password_change_invalidates_other_sessions_and_old_password(self):
        self.register(); other = self.app.test_client()
        result = other.post('/api/auth/login', json={'username': 'ALICE', 'password': PASSWORD}, headers={'Origin': ORIGIN})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.write('/api/account/security', {'action': 'password', 'password': PASSWORD, 'newPassword': PASSWORD + '-NEW'}).status_code, 200)
        self.assertEqual(other.get('/api/state').status_code, 401)
        self.assertEqual(other.post('/api/auth/login', json={'username': 'Alice', 'password': PASSWORD}, headers={'Origin': ORIGIN}).status_code, 401)

    def test_logout_revokes_session(self):
        self.register()
        self.assertEqual(self.write('/api/auth/logout', {}).status_code, 200)
        self.assertEqual(self.client.get('/api/me').status_code, 401)

    def test_bad_payloads_return_client_errors(self):
        self.register()
        for state in (None, [], {'profiles': [{'id': 'x', 'name': 'x'}], 'modules': [{'id': 'y', 'profileId': []}]}):
            with self.subTest(state=state): self.assertEqual(self.save(state).status_code, 400)
        self.assertEqual(self.save(sample(), revision=True).status_code, 400)

    def test_no_server_secrets_or_repository_files_are_served(self):
        for path in ('/.env', '/.git/config', '/server/app.py', '/data/moduly.sqlite3', '/assets/../server/app.py', '/requirements.txt'):
            with self.subTest(path=path): self.assertEqual(self.client.get(path).status_code, 404)
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        response.close()

    def test_server_exports_work_and_never_include_credentials(self):
        self.register(); self.save(sample())
        for fmt in ('json', 'csv', 'md', 'txt', 'pdf', 'ics'):
            response = self.client.get('/api/export?format=' + fmt)
            self.assertEqual(response.status_code, 200, response.data[:150])
            self.assertIn('attachment;', response.headers['Content-Disposition'])
            self.assertNotIn(b'password_hash', response.data)
            self.assertNotIn(b'recovery_hash', response.data)

    def test_invite_and_closed_registration(self):
        self.app.config['INVITE_CODE'] = 'friends-only'
        self.assertEqual(self.client.post('/api/auth/register', json={'username': 'Alice', 'password': PASSWORD}, headers={'Origin': ORIGIN}).status_code, 403)
        self.assertEqual(self.client.post('/api/auth/register', json={'username': 'Alice', 'password': PASSWORD, 'invite': 'friends-only'}, headers={'Origin': ORIGIN}).status_code, 200)
        self.app.config['REGISTRATION'] = False
        self.assertEqual(self.client.post('/api/auth/register', json={}, headers={'Origin': ORIGIN}).status_code, 403)

    def test_rate_limits_are_database_backed_and_do_not_store_raw_ip(self):
        for _ in range(16):
            result = self.client.post('/api/auth/login', json={'username': 'NoSuchUser', 'password': 'wrong'}, headers={'Origin': ORIGIN})
        self.assertEqual(result.status_code, 429)
        connection = connect(self.config['DATABASE'])
        rows = connection.execute('SELECT key FROM rate_limits').fetchall(); connection.close()
        self.assertTrue(rows)
        self.assertTrue(all(len(r['key']) == 64 and '127.0.0.1' not in r['key'] for r in rows))

    def test_encrypted_backup_verified_restore_applies_deletions(self):
        self.register(); self.save(sample())
        bob = self.app.test_client(); self.register(bob, 'Bob'); self.save(sample(), client=bob)
        with patch.dict(os.environ, {'MODULY_BACKUP_KEY': Fernet.generate_key().decode()}):
            path = backup(self.app.config)
            self.assertNotIn(b'SQLite format', path.read_bytes())
            verify(path)
            self.assertEqual(self.write('/api/account', {'password': PASSWORD}, 'DELETE').status_code, 200)
            destination = self.directory / 'restored.sqlite3'
            restore(path, destination, self.config['JOURNAL'])
            connection = connect(destination)
            self.assertEqual(connection.execute('SELECT username FROM users').fetchone()[0], 'Bob')
            self.assertEqual(connection.execute('SELECT count(*) FROM users').fetchone()[0], 1)
            self.assertEqual(connection.execute('SELECT count(*) FROM sessions').fetchone()[0], 0)
            connection.close()
            with self.assertRaises(RuntimeError): restore(path, destination, self.config['JOURNAL'])
            with self.assertRaises(RuntimeError): restore(path, self.directory / 'unsafe.sqlite3', self.directory / 'missing-journal')
        with patch.dict(os.environ, {'MODULY_BACKUP_KEY': Fernet.generate_key().decode()}):
            with self.assertRaises(InvalidToken): verify(path)

    def test_production_requires_operator_details_and_secure_origin(self):
        with self.assertRaises(RuntimeError): create_app({**self.config, 'PRODUCTION': True})
        production = create_app({**self.config, 'PRODUCTION': True, 'ORIGIN': 'https://study.example', 'OPERATOR': {'name': 'Test Operator', 'address': 'Test Address', 'email': 'operator@example.org', 'host': 'Test hosting', 'privacyExtra': ''}})
        result = production.test_client().post('/api/auth/register', json={'username': 'Alice', 'password': PASSWORD}, headers={'Origin': 'https://study.example'})
        self.assertIn('Secure', result.headers['Set-Cookie'])
        self.assertIn('max-age=', result.headers['Strict-Transport-Security'])


if __name__ == '__main__':
    unittest.main()
