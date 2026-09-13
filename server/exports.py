"""Private exports. Calendar times are unambiguous UTC; CSV cells are formula-safe."""
import copy
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from .model import Invalid

STATUS = {'open': 'Offen', 'active': 'In Arbeit', 'passed': 'Bestanden', 'failed': 'Nicht bestanden'}


def ics_escape(value):
    return str(value).replace('\\', '\\\\').replace('\r', '').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')


def fold_line(line):
    chunks, part = [], ''
    for char in line:
        if len((part + char).encode()) > 75:
            chunks.append(part)
            part = ' '
        part += char
    chunks.append(part)
    return '\r\n'.join(chunks)


def calendar(events, modules):
    names = {m['id']: m['name'] for m in modules}
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moduly//Study Calendar 1.0//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for event in events:
        start = datetime.fromisoformat(event['start']).replace(tzinfo=ZoneInfo(event['timezone'])).astimezone(timezone.utc)
        end = start + timedelta(minutes=event['duration'])
        description = '\n'.join(filter(None, [names.get(event['moduleId']), event['notes'],
            'Persönlicher Termin. Bei Änderungen die Kalenderkopie aktualisieren.']))
        lines.extend(['BEGIN:VEVENT', f"UID:{event['id']}@moduly", f'DTSTAMP:{stamp}',
            f'DTSTART:{start:%Y%m%dT%H%M%SZ}', f'DTEND:{end:%Y%m%dT%H%M%SZ}',
            'SUMMARY:' + ics_escape(event['title']), 'LOCATION:' + ics_escape(event['location']),
            'DESCRIPTION:' + ics_escape(description)])
        trigger_by_minutes = {10080: '-P7D', 1440: '-P1D', 120: '-PT2H'}
        for minutes in event.get('reminders', [10080, 1440]):
            trigger = trigger_by_minutes[minutes]
            lines.extend(['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ics_escape(event['title']), f'TRIGGER:{trigger}', 'END:VALARM'])
        lines.append('END:VEVENT')
    lines.append('END:VCALENDAR')
    return ('\r\n'.join(fold_line(line) for line in lines) + '\r\n').encode()


def csv_safe(value):
    result = str(value) if value is not None else ''
    if result.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')):
        result = "'" + result
    return result


def selected(state, profile_id, options):
    state = copy.deepcopy(state)
    if profile_id:
        state['profiles'] = [p for p in state['profiles'] if p['id'] == profile_id]
        for key in ('modules', 'events', 'tasks'):
            state[key] = [row for row in state[key] if row['profileId'] == profile_id]
    if not options.get('open', True):
        state['modules'] = [m for m in state['modules'] if m['status'] == 'passed']
    for m in state['modules']:
        if not options.get('grades', True):
            m['grade'] = None
            for c in m['components']:
                c['grade'] = None
        if not options.get('attempts', True):
            m['attempts'] = None
    if not options.get('events', True):
        state['events'] = []
    if not options.get('notes', True):
        state['settings']['note'] = ''
        for key in ('modules', 'events', 'tasks'):
            for row in state[key]:
                row['notes'] = ''
    return state


def markdown(state):
    def clean(value):
        return str(value).replace('\\', '\\\\').replace('|', '\\|').replace('<', '&lt;').replace('>', '&gt;').replace('\n', ' / ')
    out = ['# Mein Studium', '', 'Persönliche Einträge. Keine offizielle Leistungsübersicht.', '']
    for p in state['profiles']:
        out += [f"## {clean(p['name'])}", '', f"{clean(p['university'])} · {clean(p['degree'])} · PO {clean(p['po'])}", '',
            '| Modul | Semester | ECTS | Status | Note | Versuche |', '| --- | ---: | ---: | --- | ---: | ---: |']
        modules = sorted((m for m in state['modules'] if m['profileId'] == p['id']), key=lambda m: (m['semester'], m['name']))
        for m in modules:
            out.append('| ' + ' | '.join(clean(x if x is not None else '') for x in [m['name'], m['semester'], m['ects'], STATUS[m['status']], m['grade'], m['attempts']]) + ' |')
        for m in modules:
            if m['notes']:
                out += ['', f"Notiz zu {clean(m['name'])}: {clean(m['notes'])}", '']
        out += ['', '### Termine', '']
        for e in sorted((e for e in state['events'] if e['profileId'] == p['id']), key=lambda e: e['start']):
            out += [f"- {clean(e['start'])} ({clean(e['timezone'])}): {clean(e['title'])}; {clean(e['location'])}"]
            if e['notes']:
                out += [f"  {clean(e['notes'])}"]
        out += ['', '### Aufgaben', '']
        for t in state['tasks']:
            if t['profileId'] == p['id']:
                out += [f"- [{'x' if t['done'] else ' '}] {clean(t['title'])} · {clean(t['due'])} · {t['minutes']} Min."]
                if t['notes']:
                    out += [f"  {clean(t['notes'])}"]
    if state['settings']['note']:
        out += ['', '## Persönliche Notiz', '', state['settings']['note']]
    return '\n'.join(out) + '\n'


def plain_text(state):
    out = ['MEIN STUDIUM', 'Persönliche Einträge. Keine offizielle Leistungsübersicht.', '']
    for p in state['profiles']:
        out += [p['name'], ' · '.join(filter(None, [p['university'], p['degree'], 'PO ' + p['po'] if p['po'] else ''])), '']
        for m in sorted((m for m in state['modules'] if m['profileId'] == p['id']), key=lambda m: (m['semester'], m['name'])):
            out += [f"{m['name']} ({m['code'] or 'Modulnummer offen'})",
                f"Semester {m['semester']} · {m['ects']} ECTS · {STATUS[m['status']]}"]
            if m['grade'] is not None:
                out += [f"Note: {m['grade']}"]
            if m['attempts'] is not None:
                out += [f"Versuche: {m['attempts']}"]
            if m['notes']:
                out += [m['notes']]
            out += ['']
        if state['events']:
            out += ['TERMINE']
            for e in state['events']:
                if e['profileId'] == p['id']:
                    out += [f"{e['start'].replace('T', ' ')} ({e['timezone']}) · {e['title']} · {e['location']}", e['notes']]
        if state['tasks']:
            out += ['', 'AUFGABEN']
            for t in state['tasks']:
                if t['profileId'] == p['id']:
                    out += [f"{'Erledigt' if t['done'] else 'Offen'}: {t['title']} · {t['due']} · {t['minutes']} Min.", t['notes']]
    if state['settings']['note']:
        out += ['', 'PERSÖNLICHE NOTIZ', state['settings']['note']]
    return '\n'.join(out) + '\n'


def pdf(state):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    font = 'Helvetica'
    font_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    if font_path.exists():
        font = 'ModulySans'
        if font not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(font, str(font_path)))
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = font
    styles['Normal'].fontSize = 9
    styles['Normal'].leading = 14
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=45, bottomMargin=45, title='Moduly Studienübersicht', author='Moduly')
    story = [Paragraph('Mein Studium', styles['Title']), Paragraph('Persönliche Einträge. Keine offizielle Leistungsübersicht.', styles['Normal']), Spacer(1, 20)]
    def para(value, style='Normal'):
        return Paragraph(escape(str(value if value is not None else '')).replace('\n', '<br/>'), styles[style])
    for p in state['profiles']:
        story += [para(p['name'], 'Heading2'), para(f"{p['university']} · {p['degree']} · PO {p['po']}"), Spacer(1, 12)]
        rows = [[para(x) for x in ('Modul / Semester', 'ECTS', 'Status', 'Note', 'Versuche')]]
        modules = sorted((m for m in state['modules'] if m['profileId'] == p['id']), key=lambda m: (m['semester'], m['name']))
        for m in modules:
            rows.append([para(f"{m['name']} / {m['semester']}"), para(m['ects']), para(STATUS[m['status']]), para(m['grade']), para(m['attempts'])])
        table = Table(rows, colWidths=[215, 45, 105, 45, 65], repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#d8e5de')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -1), .35, colors.HexColor('#d8dcd5')),
            ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
        story += [table, Spacer(1, 14)]
        for m in modules:
            if m['notes']:
                story += [para(m['name'], 'Heading3'), para(m['notes'])]
        events = sorted((e for e in state['events'] if e['profileId'] == p['id']), key=lambda e: e['start'])
        if events:
            story += [para('Termine', 'Heading3')]
            for e in events:
                story += [para(f"{e['start'].replace('T', ' ')} ({e['timezone']}) · {e['title']} · {e['location']}"), para(e['notes'])]
        tasks = [t for t in state['tasks'] if t['profileId'] == p['id']]
        if tasks:
            story += [para('Aufgaben', 'Heading3')]
            for t in tasks:
                story += [para(f"{'Erledigt' if t['done'] else 'Offen'}: {t['title']} · {t['due']} · {t['minutes']} Min."), para(t['notes'])]
    if state['settings']['note']:
        story += [para('Persönliche Notiz', 'Heading2'), para(state['settings']['note'])]
    def footer(canvas, doc):
        canvas.setFont(font, 8)
        canvas.drawString(40, 25, 'Moduly · ' + datetime.now().strftime('%d.%m.%Y'))
        canvas.drawRightString(A4[0] - 40, 25, str(doc.page))
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def export(state, fmt, profile_id='', options=None, user=None):
    if fmt == 'json':
        # Complete portable archive, intentionally independent of print filters.
        data = {'format': 'moduly', 'version': 1, 'exportedAt': datetime.now(timezone.utc).isoformat(), 'account': user or {}, 'state': state}
        return json.dumps(data, ensure_ascii=False, indent=2).encode(), 'application/json', 'moduly.json'
    state = selected(state, profile_id, options or {})
    if fmt == 'ics':
        return calendar(state['events'], state['modules']), 'text/calendar', 'moduly-kalender.ics'
    if fmt == 'csv':
        buffer = io.StringIO(newline='')
        writer = csv.writer(buffer, delimiter=';')
        writer.writerow(['Studienprofil', 'Modul', 'Modulnummer', 'Semester', 'ECTS', 'Status', 'Note', 'Versuche', 'Quelle', 'Notiz'])
        names = {p['id']: p['name'] for p in state['profiles']}
        for m in state['modules']:
            writer.writerow([csv_safe(x) for x in [names[m['profileId']], m['name'], m['code'], m['semester'], m['ects'], STATUS[m['status']], m['grade'], m['attempts'], m['source'], m['notes']]])
        return ('\ufeff' + buffer.getvalue()).encode(), 'text/csv', 'moduly-module.csv'
    if fmt in ('md', 'txt'):
        content = plain_text(state) if fmt == 'txt' else markdown(state)
        return content.encode(), 'text/plain' if fmt == 'txt' else 'text/markdown', 'moduly.' + fmt
    if fmt == 'pdf':
        return pdf(state), 'application/pdf', 'moduly-studienplan.pdf'
    raise Invalid('Unbekanntes Exportformat.')
