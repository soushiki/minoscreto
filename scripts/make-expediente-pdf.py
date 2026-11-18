# Genera un expediente de prueba (por defecto 600 folios) que imita un PDF pasado por OCR en Acrobat:
# encabezado y pie repetidos, número de página, guiones de fin de línea, líneas basura de OCR,
# errores de OCR en algunos nombres y folios sin texto (escaneos sin OCR).
# Uso: python scripts/make-expediente-pdf.py [salida.pdf] [folios]
# Escribe también <salida>.verdad.json con los datos sembrados, para medir la detección.
# Uso: python scripts/make-expediente-pdf.py --fixtures  → PDFs sintéticos de prueba en tests/fixtures/
#      (ver tests/fixtures/README.md: cómo se hizo cada uno y su contraseña).
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

import pymupdf

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests', 'fixtures')
USER_PASSWORD = 'minoscreto-prueba'
OWNER_PASSWORD = 'propietario-prueba'
FIXTURE_LINES = [
    'Juzgado Tercero Civil del Circuito de Bogotá',
    'Radicado 11001310300320230012300',
    'Demandante: Laura Patricia Ortega Jiménez, C.C. 45.521.884',
    'Demandada: Inversiones Bahía del Caribe S.A.S., NIT 901.234.567-8',
    'Dirección: Calle 32 No. 8-45, teléfono 315 482 7731',
    '¿Procede la acción? Sí: la señora Ortega acreditó el daño (artículo 1º).',
]


def _text_pdf(lines, path, **save_opts):
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)  # Carta
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11, fontname='helv')
        y += 16
    doc.set_metadata({'producer': 'Minoscreto fixtures', 'creator': 'Minoscreto fixtures'})
    doc.save(path, garbage=3, deflate=True, **save_opts)
    doc.close()


# Respuesta anonimizada con etiquetas cortadas al final de línea, como las deja una exportación a PDF.
# Las claves del diccionario van en el .json del mismo nombre.
SPLIT_LINES = [
    'Resumen del caso',
    'La demandante [PERSONA_1] reclama a [EMPRE-',
    'SA_1] el pago de la indemnización. El apoderado [PERSONA_',
    '2] pidió pruebas. [PERSONA_1] vive en [DIRECCION_1',
    '] y su cédula es [CEDULA_1]. Un texto normal [entre corchetes',
    'y con salto] no es una etiqueta y debe quedar igual.',
    'Contacto: [TELEFONO_1]. Fin.',
]
SPLIT_KEYS = ['[PERSONA_1]', '[PERSONA_2]', '[EMPRESA_1]', '[DIRECCION_1]', '[CEDULA_1]', '[TELEFONO_1]']

CHROME_HTML = '''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Respuesta</title>
<style>body{font-family:Arial,sans-serif;font-size:12pt;margin:0}main{width:62mm}
td{border:1px solid #888;padding:2px;word-break:break-all;width:28mm}</style></head><body><main>
<h1>Análisis del caso</h1>
<p>• [PERSONA_1] demandó a [EMPRESA_1] por incumplimiento del contrato firmado en [DIRECCION_1].</p>
<p>• El apoderado [PERSONA_2] presentó la cédula [CEDULA_1] y el teléfono [TELEFONO_1].</p>
<p>“Conclusión”: la pretensión de [PERSONA_1] procede según el artículo 1º.</p>
<table><tr><td>[PERSONA_1][EMPRESA_1]</td><td>[DIRECCION_1][CEDULA_1]</td></tr></table>
</main></body></html>'''


def _chrome():
    for p in (r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe', shutil.which('chrome')):
        if p and os.path.exists(p):
            return p
    raise SystemExit('No encuentro Chrome para la fixture chrome_guardar_como_sintetico.pdf')


def make_fixtures():
    os.makedirs(FIXTURES, exist_ok=True)
    out = lambda name: os.path.join(FIXTURES, name)  # noqa: E731
    _text_pdf(FIXTURE_LINES, out('contrasena_usuario_sintetico.pdf'), encryption=pymupdf.PDF_ENCRYPT_AES_256,
              user_pw=USER_PASSWORD, owner_pw=OWNER_PASSWORD,
              permissions=pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_COPY | pymupdf.PDF_PERM_PRINT)
    _text_pdf(FIXTURE_LINES, out('solo_propietario_sintetico.pdf'), encryption=pymupdf.PDF_ENCRYPT_AES_256,
              user_pw='', owner_pw=OWNER_PASSWORD, permissions=pymupdf.PDF_PERM_ACCESSIBILITY)
    _text_pdf(SPLIT_LINES, out('etiquetas_fin_de_linea_sintetico.pdf'))
    with open(out('etiquetas_fin_de_linea_sintetico.json'), 'w', encoding='utf-8') as f:
        json.dump({'keys': SPLIT_KEYS}, f, ensure_ascii=False, indent=2)
    with tempfile.TemporaryDirectory() as tmp:
        html = os.path.join(tmp, 'respuesta.html')
        with open(html, 'w', encoding='utf-8') as f:
            f.write(CHROME_HTML)
        pdf = os.path.abspath(out('chrome_guardar_como_sintetico.pdf'))
        subprocess.run([_chrome(), '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                        f'--user-data-dir={os.path.join(tmp, "perfil")}', f'--print-to-pdf={pdf}',
                        'file:///' + html.replace('\\', '/')], check=True, timeout=120,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for name in sorted(os.listdir(FIXTURES)):
        print(name, os.path.getsize(out(name)), 'bytes')


if len(sys.argv) > 1 and sys.argv[1] == '--fixtures':
    make_fixtures()
    sys.exit(0)

OUT =sys.argv[1] if len(sys.argv) > 1 else '.local/expediente-600.pdf'
PAGES = int(sys.argv[2]) if len(sys.argv) > 2 else 600
rng = random.Random(7)

PEOPLE = [
    ('Laura Patricia Ortega Jiménez', '45.521.884'), ('Carlos Andrés Mendoza Ríos', '1.047.382.915'),
    ('María Fernanda Quintero Salas', '52.874.110'), ('Jorge Eliécer Gaitán Rojas', '79.456.230'),
    ('Ana Lucía Restrepo Mejía', '43.112.908'), ('Luis Alberto Cárdenas Peña', '80.765.431'),
    ('Diana Marcela Torres Gómez', '1.020.456.789'), ('Pedro Pablo Henao Vélez', '71.334.556'),
    ('Sandra Milena Ruiz Ospina', '39.887.123'), ('Juan Sebastián Arango López', '1.128.443.902'),
    ('Claudia Patricia Morales Díaz', '51.990.334'), ('Hernán Darío Zapata Muñoz', '98.556.778'),
    ('Gloria Inés Castaño Duque', '24.556.889'), ('Andrés Felipe Valencia Rincón', '1.053.778.221'),
    ('Martha Lucía Pérez Herrera', '41.223.667'), ('Óscar Iván Londoño Giraldo', '75.889.012'),
]
COMPANIES = [
    ('Inversiones Bahía del Caribe S.A.S.', '901.234.567-8'), ('Constructora Andina de Occidente S.A.', '860.123.456-1'),
    ('Transportes El Llano Ltda.', '800.456.789-3'), ('Distribuidora La Sabana S.A.S.', '900.765.432-0'),
]
STREETS = ['Calle 32 No. 8-45', 'Carrera 7 No. 71-21', 'Avenida 68 No. 24-10', 'Calle 100 No. 15-32', 'Carrera 43A No. 1-50']
PHONES = ['315 482 7731', '300 221 9087', '601 345 6677', '312 908 1144']
HEADINGS = ['ANTECEDENTES', 'HECHOS', 'PRETENSIONES', 'CONSIDERANDOS', 'PROBLEMA JURÍDICO', 'PRUEBAS', 'RESUELVE']
RAD = '11001310300320230012300'

OCR_SWAPS = [('l', '1'), ('o', '0'), ('í', 'i'), ('é', 'e'), ('rn', 'm'), ('m', 'rn'), ('a', 'á'), ('i', 'l')]


def ocr_error(s):
    for _ in range(10):
        a, b = rng.choice(OCR_SWAPS)
        idx = [i for i in range(1, len(s)) if s.startswith(a, i)]
        if idx:
            i = rng.choice(idx)
            return s[:i] + b + s[i + len(a):]
    return s


truth = {'people': {}, 'companies': {}, 'ids': [], 'ocrVariants': []}


def mention_person():
    name, cc = rng.choice(PEOPLE)
    truth['people'].setdefault(name, 0)
    truth['people'][name] += 1
    shown = name
    if rng.random() < 0.06:
        shown = ocr_error(name)
        truth['ocrVariants'].append({'original': name, 'ocr': shown})
    if rng.random() < 0.35:
        truth['ids'].append(cc)
        return f'{shown}, identificado con cédula de ciudadanía No. {cc}'
    return shown


def mention_company():
    name, nit = rng.choice(COMPANIES)
    truth['companies'].setdefault(name, 0)
    truth['companies'][name] += 1
    if rng.random() < 0.4:
        truth['ids'].append(nit)
        return f'{name}, con NIT {nit}'
    return name


SENTENCES = [
    lambda: f'El señor {mention_person()} presentó demanda contra {mention_company()} por el incumplimiento del contrato de suministro.',
    lambda: f'Mediante auto del despacho se ordenó correr traslado a {mention_person()} por el término de diez días hábiles.',
    lambda: f'La apoderada {mention_person()} allegó memorial en el que solicita el decreto de pruebas documentales y testimoniales.',
    lambda: f'Se recibió la declaración de {mention_person()}, quien manifestó residir en la {rng.choice(STREETS)} de esta ciudad.',
    lambda: f'Para notificaciones la parte demandada informó el teléfono {rng.choice(PHONES)} y la dirección {rng.choice(STREETS)}.',
    lambda: f'La sociedad {mention_company()} contestó la demanda dentro del término y propuso excepciones de mérito.',
    lambda: 'El despacho advierte que se cumplen los presupuestos procesales de competencia, capacidad para ser parte y demanda en forma.',
    lambda: 'Conforme al artículo 167 del Código General del Proceso, incumbe a las partes probar el supuesto de hecho de las normas que consagran el efecto jurídico que ellas persiguen.',
    lambda: 'No se observa causal de nulidad que invalide lo actuado, por lo que se procede a decidir de fondo la controversia planteada.',
    lambda: f'Obra en el expediente el certificado de existencia y representación legal de {mention_company()}, expedido por la Cámara de Comercio.',
    lambda: f'El testigo {mention_person()} afirmó haber presenciado la entrega de la mercancía en la bodega ubicada en la {rng.choice(STREETS)}.',
    lambda: 'En consecuencia, se analizarán las pruebas allegadas en su conjunto, de acuerdo con las reglas de la sana crítica.',
]


def paragraph():
    return ' '.join(rng.choice(SENTENCES)() for _ in range(rng.randint(2, 5)))


def wrap(text, width=92):
    """Corta en líneas; a veces divide una palabra larga con guion, como hace un texto justificado."""
    words, lines, cur = text.split(), [], ''
    for w in words:
        if len(cur) + 1 + len(w) <= width:
            cur = f'{cur} {w}'.strip()
            continue
        room = width - len(cur) - 2
        if len(w) >= 9 and room >= 4 and w.isalpha() and rng.random() < 0.5:
            cut = min(room, len(w) - 3)
            lines.append(f'{cur} {w[:cut]}-')
            cur = w[cut:]
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


BLANK_PAGES = {45, 46, 300, 517}
doc = pymupdf.open()
heading_no = 0
pending = []
for n in range(1, PAGES + 1):
    page = doc.new_page(width=612, height=792)
    if n in BLANK_PAGES:
        page.draw_rect(pymupdf.Rect(60, 80, 552, 720), color=(0.6, 0.6, 0.6), fill=(0.93, 0.93, 0.9))
        continue
    page.insert_text((72, 50), 'JUZGADO TERCERO CIVIL DEL CIRCUITO DE BOGOTÁ D.C.', fontname='hebo', fontsize=9)
    page.insert_text((72, 62), f'Radicado No. {RAD}', fontname='helv', fontsize=8)
    y = 96
    heading_due = n % 40 == 1 or n == 2
    if rng.random() < 0.08:
        pending.insert(0, ('j', rng.choice(["' . , ~ ¦", '|||  ..  ,', '.. - ._', 'i l ! ; ·'])))
    while len(pending) < 60:
        pending.append(('blank', ''))
        if heading_due:
            heading_no += 1
            heading_due = False
            pending.append(('h', f'CAPÍTULO {heading_no}' if heading_no % 3 == 1 else f'{heading_no}. {HEADINGS[heading_no % len(HEADINGS)]}'))
            pending.append(('blank', ''))
        for i, line in enumerate(wrap(paragraph())):
            pending.append(('p0' if i == 0 else 'p', line))
    # Lo que no cabe sigue en el folio siguiente, a veces a mitad de frase o de nombre.
    while pending and y <= 712:
        kind, line = pending.pop(0)
        if kind == 'blank':
            y += 8
            continue
        x = 90 if kind == 'p0' else 72
        font = 'hebo' if kind == 'h' else 'helv'
        page.insert_text((x, y), line, fontname=font, fontsize=11 if kind == 'h' else 10)
        y += 14 if kind == 'h' else 12.5
    page.insert_text((280, 760), f'Página {n} de {PAGES}', fontname='helv', fontsize=8)

doc.save(OUT, garbage=3, deflate=True)
with open(OUT.rsplit('.', 1)[0] + '.verdad.json', 'w', encoding='utf-8') as f:
    truth['blankPages'] = sorted(BLANK_PAGES)
    truth['ids'] = sorted(set(truth['ids']))
    json.dump(truth, f, ensure_ascii=False, indent=1)
print(OUT, PAGES, 'folios')
