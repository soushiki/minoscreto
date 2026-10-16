# Genera un expediente de prueba (por defecto 600 folios) que imita un PDF pasado por OCR en Acrobat:
# encabezado y pie repetidos, número de página, guiones de fin de línea, líneas basura de OCR,
# errores de OCR en algunos nombres y folios sin texto (escaneos sin OCR).
# Uso: python scripts/make-expediente-pdf.py [salida.pdf] [folios]
# Escribe también <salida>.verdad.json con los datos sembrados, para medir la detección.
import json
import random
import sys

import pymupdf

OUT = sys.argv[1] if len(sys.argv) > 1 else '.local/expediente-600.pdf'
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
