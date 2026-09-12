"""Canonical state validation. No user IDs, roles or permissions accepted in a study plan."""
import math
import re
from datetime import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class Invalid(ValueError):
    pass


def text(value, maximum=200, required=False):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise Invalid('Ungültiger oder zu langer Text.')
    value = value.strip()
    if required and not value:
        raise Invalid('Bitte alle Pflichtfelder ausfüllen.')
    return value


def number(value, low=0, high=1000, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high or (integer and int(value) != value):
        raise Invalid('Zahl außerhalb des erlaubten Bereichs.')
    return value


def choice(value, choices):
    if value not in choices:
        raise Invalid('Ungültige Auswahl.')
    return value


def uid(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', value):
        raise Invalid('Ungültige Kennung.')
    return value


def url(value):
    value = text(value, 1000)
    if value:
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
        except ValueError:
            raise Invalid('Ungültiger Quellenlink.') from None
        if parsed.scheme not in ('http', 'https') or not hostname or parsed.username or parsed.password:
            raise Invalid('Quellen müssen vollständige http(s)-Links sein.')
    return value


def empty_state():
    return {'profiles': [], 'modules': [], 'events': [], 'tasks': [], 'settings': {
        'activeProfile': '', 'widgets': ['progress', 'exams', 'tasks', 'note'],
        'note': '', 'compact': False, 'motion': True, 'theme': 'light'}}


def rows(data, key, limit):
    result = data.get(key, [])
    if not isinstance(result, list) or len(result) > limit or any(not isinstance(x, dict) for x in result):
        raise Invalid('Zu viele oder ungültige Einträge.')
    ids = [uid(x.get('id')) for x in result]
    if len(set(ids)) != len(ids):
        raise Invalid('Doppelte Kennungen im Import.')
    return result


def validate(data):
    if not isinstance(data, dict):
        raise Invalid('Ungültiger Studienplan.')
    result = empty_state()
    for p in rows(data, 'profiles', 12):
        result['profiles'].append({'id': p['id'], 'name': text(p.get('name'), 150, True),
            'university': text(p.get('university', ''), 150), 'degree': text(p.get('degree', ''), 80),
            'po': text(p.get('po', ''), 80), 'targetEcts': number(p.get('targetEcts', 210), 1, 1000),
            'semesters': number(p.get('semesters', 7), 1, 20, True),
            'currentSemester': number(p.get('currentSemester', 1), 1, 30, True),
            'archived': p.get('archived') is True, 'thesisEcts': number(p.get('thesisEcts', 0), 0, 1000),
            'source': url(p.get('source', ''))})
    profiles = {p['id']: p for p in result['profiles']}
    for m in rows(data, 'modules', 1000):
        if uid(m.get('profileId')) not in profiles:
            raise Invalid('Modul gehört zu keinem vorhandenen Studienprofil.')
        grade = m.get('grade')
        if grade is not None:
            number(grade, 1, 5)
        status = choice(m.get('status', 'open'), ('open', 'active', 'passed', 'failed'))
        if status == 'passed' and grade is not None and grade > 4:
            raise Invalid('Eine Note über 4,0 kann nicht als bestanden gelten.')
        if status == 'failed' and grade is not None and grade <= 4:
            raise Invalid('Eine bestandene Note passt nicht zum Status nicht bestanden.')
        prereqs = m.get('prerequisites', [])
        if not isinstance(prereqs, list) or len(prereqs) > 50:
            raise Invalid('Ungültige Voraussetzungen.')
        components = []
        for c in rows(m, 'components', 20):
            cg = c.get('grade')
            if cg is not None:
                number(cg, 1, 5)
            components.append({'id': c['id'], 'name': text(c.get('name'), 150, True),
                'weight': number(c.get('weight', 0), 0, 100), 'grade': cg,
                'required': c.get('required') is True, 'passed': c.get('passed') is True})
        if sum(c['weight'] for c in components) > 100.001:
            raise Invalid('Die Gewichtung der Prüfungsbestandteile darf 100 % nicht überschreiten.')
        if status == 'passed' and any(c['required'] and not c['passed'] for c in components):
            raise Invalid('Ein erforderlicher Prüfungsbestandteil ist noch nicht bestanden.')
        result['modules'].append({'id': m['id'], 'profileId': m['profileId'],
            'name': text(m.get('name'), 150, True), 'code': text(m.get('code', ''), 60),
            'ects': number(m.get('ects', 5), 0, 60),
            'semester': number(m.get('semester', 1), 1, 30, True), 'status': status, 'grade': grade,
            'attempts': number(m.get('attempts', 0), 0, 20, True),
            'examType': text(m.get('examType', ''), 80), 'duration': number(m.get('duration', 0), 0, 600, True),
            'materials': text(m.get('materials', ''), 2000), 'notes': text(m.get('notes', ''), 10000),
            'source': url(m.get('source', '')), 'sourceDate': text(m.get('sourceDate', ''), 30),
            'prerequisites': [uid(x) for x in prereqs], 'thesisRequired': m.get('thesisRequired') is True,
            'components': components, 'edited': True})
    modules = {m['id']: m for m in result['modules']}
    for m in result['modules']:
        for ref in m['prerequisites']:
            if ref == m['id'] or ref not in modules or modules[ref]['profileId'] != m['profileId']:
                raise Invalid('Voraussetzungen müssen andere Module desselben Studienprofils sein.')
    # Iterative topological sort also handles a 1,000-module chain without recursion.
    dependencies = {ref: set(m['prerequisites']) for ref, m in modules.items()}
    ready = [ref for ref, deps in dependencies.items() if not deps]
    processed = set()
    while ready:
        ref = ready.pop()
        processed.add(ref)
        for child, deps in dependencies.items():
            if ref in deps:
                deps.remove(ref)
                if not deps:
                    ready.append(child)
    if len(processed) != len(modules):
        raise Invalid('Voraussetzungen dürfen keinen Kreis bilden.')
    for e in rows(data, 'events', 2000):
        if uid(e.get('profileId')) not in profiles:
            raise Invalid('Termin gehört zu keinem Studienprofil.')
        module_id = text(e.get('moduleId', ''), 80)
        if module_id and (uid(module_id) not in modules or modules[module_id]['profileId'] != e['profileId']):
            raise Invalid('Termin und Modul müssen demselben Profil gehören.')
        start = text(e.get('start'), 40, True)
        zone = text(e.get('timezone', 'Europe/Berlin'), 60, True)
        try:
            local = datetime.fromisoformat(start)
            tz = ZoneInfo(zone)
            if local.tzinfo is not None or not 2000 <= local.year <= 2100:
                raise ValueError()
            # Reject nonexistent DST times; for ambiguous times fold 0 is explicit.
            if local.replace(tzinfo=tz).astimezone(ZoneInfo('UTC')).astimezone(tz).replace(tzinfo=None) != local:
                raise ValueError()
        except (ValueError, ZoneInfoNotFoundError):
            raise Invalid('Ungültiges Datum, Zeitzone oder Uhrzeit bei Zeitumstellung.') from None
        result['events'].append({'id': e['id'], 'profileId': e['profileId'], 'moduleId': module_id,
            'title': text(e.get('title'), 150, True), 'start': start, 'timezone': zone,
            'duration': number(e.get('duration', 90), 1, 1440, True),
            'kind': choice(e.get('kind', 'exam'), ('exam', 'submission', 'presentation', 'lab', 'registration', 'deadline', 'personal')),
            'location': text(e.get('location', ''), 300), 'notes': text(e.get('notes', ''), 4000)})
    for t in rows(data, 'tasks', 2000):
        if uid(t.get('profileId')) not in profiles:
            raise Invalid('Aufgabe gehört zu keinem Studienprofil.')
        due = text(t.get('due', ''), 10)
        if due:
            try:
                datetime.strptime(due, '%Y-%m-%d')
            except ValueError:
                raise Invalid('Ungültiges Aufgabendatum.') from None
        result['tasks'].append({'id': t['id'], 'profileId': t['profileId'], 'title': text(t.get('title'), 300, True),
            'due': due, 'done': t.get('done') is True, 'minutes': number(t.get('minutes', 60), 0, 10000, True),
            'notes': text(t.get('notes', ''), 4000)})
    s = data.get('settings', {})
    if not isinstance(s, dict):
        raise Invalid('Ungültige Einstellungen.')
    widgets = s.get('widgets', ['progress', 'exams', 'tasks', 'note'])
    if not isinstance(widgets, list) or len(widgets) > 4 or any(x not in ('progress', 'exams', 'tasks', 'note') for x in widgets):
        raise Invalid('Ungültige Dashboard-Auswahl.')
    active = text(s.get('activeProfile', ''), 80)
    if active and active not in profiles:
        raise Invalid('Aktives Studienprofil fehlt.')
    result['settings'] = {'activeProfile': active, 'widgets': list(dict.fromkeys(widgets)),
        'note': text(s.get('note', ''), 10000), 'compact': s.get('compact') is True,
        'motion': s.get('motion', True) is not False, 'theme': choice(s.get('theme', 'light'), ('light', 'dark'))}
    return result


def summary(state, profile_id):
    modules = [m for m in state['modules'] if m['profileId'] == profile_id]
    passed = [m for m in modules if m['status'] == 'passed']
    graded = [m for m in passed if m['grade'] is not None and m['ects'] > 0]
    weight = sum(m['ects'] for m in graded)
    return {'ects': sum(m['ects'] for m in passed), 'passed': len(passed),
        'average': round(sum(m['grade'] * m['ects'] for m in graded) / weight, 2) if weight else None,
        'active': sum(m['status'] == 'active' for m in modules)}
