"""Checked public study catalog bundled with the release."""
import json

from .model import Invalid, text, uid, url, validate


def load_catalog(path):
    try:
        raw = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError('Der Studienkatalog kann nicht geladen werden.') from exc
    if not isinstance(raw, dict) or raw.get('catalogVersion') != 1:
        raise RuntimeError('Unbekannte Studienkatalog-Version.')
    checked_at = text(raw.get('checkedAt'), 30, True)
    universities, seen_universities = [], set()
    for entry in raw.get('universities', []):
        if not isinstance(entry, dict):
            raise Invalid('Ungültiger Hochschuleintrag im Katalog.')
        university_id = uid(entry.get('id'))
        if university_id in seen_universities:
            raise Invalid('Doppelte Hochschule im Katalog.')
        seen_universities.add(university_id)
        universities.append({'id': university_id, 'name': text(entry.get('name'), 150, True),
            'location': text(entry.get('location', ''), 150), 'source': url(entry.get('source', ''))})
    templates, seen_templates = [], set()
    for entry in raw.get('templates', []):
        if not isinstance(entry, dict):
            raise Invalid('Ungültige Studienvorlage im Katalog.')
        template_id = uid(entry.get('id'))
        if template_id in seen_templates:
            raise Invalid('Doppelte Studienvorlage im Katalog.')
        seen_templates.add(template_id)
        version = entry.get('version')
        updated_at = entry.get('updated_at')
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise Invalid('Ungültige Vorlagenversion im Katalog.')
        if isinstance(updated_at, bool) or not isinstance(updated_at, int) or updated_at < 1:
            raise Invalid('Ungültiger Prüfzeitpunkt im Katalog.')
        sources = []
        for source in entry.get('sources', []):
            if not isinstance(source, dict):
                raise Invalid('Ungültige Vorlagenquelle im Katalog.')
            sources.append({'label': text(source.get('label'), 200, True), 'url': url(source.get('url', ''))})
        data = validate(entry.get('data'))
        if len(data['profiles']) != 1 or not data['profiles'][0]['source'] or any(not module['source'] for module in data['modules']):
            raise Invalid('Katalogvorlagen benötigen genau ein Profil und Quellen an allen Modulen.')
        if data['events'] or data['tasks'] or data['settings']['note'] or any(
                module['status'] != 'open' or module['grade'] is not None or module['attempts'] or module['notes']
                or any(component['grade'] is not None or component['passed'] for component in module['components'])
                for module in data['modules']):
            raise Invalid('Katalogvorlagen dürfen keine persönlichen Leistungen oder Notizen enthalten.')
        templates.append({'id': template_id, 'version': version, 'updated_at': updated_at,
            'checkedAt': text(entry.get('checkedAt', checked_at), 30, True),
            'verification': text(entry.get('verification', ''), 500),
            'notice': text(entry.get('notice', ''), 1000), 'sources': sources, 'data': data})
    return {'catalogVersion': 1, 'checkedAt': checked_at, 'universities': universities, 'templates': templates}
