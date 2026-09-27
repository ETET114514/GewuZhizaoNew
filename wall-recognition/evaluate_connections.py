"""Reproduce local connection checks on three existing floor-plan styles."""
import json
from pathlib import Path

from PIL import Image, ImageDraw

from connect_walls import connect_walls, connection_audit, SOURCE
from recognize_walls import detect_walls
from recognize_openings import detect_openings
from refine_walls import initialize_refinement
from web_server import SETTINGS

ROOT = Path(__file__).parent
OUT = ROOT/'output/connections-v1'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    reports = []
    for name, path in [('default', 'input/floorplan.png'),
                       ('dense', 'input/reference-plans/07-dense-furnished.png'),
                       ('pale', 'input/furniture-references/11-light-rendered.png')]:
        image = Image.open(ROOT/path).convert('RGB')
        walls = detect_walls(image, **SETTINGS)
        doc = initialize_refinement(dict(image=dict(width_px=image.width, height_px=image.height),
                                         parameters=SETTINGS, walls=walls,
                                         openings=detect_openings(image, walls)), image)
        reserved = [*doc['opening_wall_ids'].values(), *(w['id'] for w in doc['walls'])]
        next_id = max(int(i[1:]) for i in reserved)+1
        after, record, next_id = connect_walls(doc, image, next_id)
        repeated, _, final_id = connect_walls(after, image, next_id)
        assert repeated['walls'] == after['walls'], 'Repeated repair changed geometry'
        assert final_id == next_id
        (OUT/f'{name}.json').write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding='utf-8')
        panels = []
        for data in (doc, after):
            layer = Image.new('RGBA', image.size)
            ink = ImageDraw.Draw(layer)
            repaired = {w['id'] for w in data['walls'] if w.get('source') == SOURCE}
            for part in data['solid_wall_segments']:
                color = (235, 120, 20, 210) if part['host_wall_id'] in repaired else (30, 100, 220, 90)
                ink.rectangle(part['bbox_px'], fill=color)
            panels.append(Image.alpha_composite(image.convert('RGBA'), layer).convert('RGB'))
        canvas = Image.new('RGB', (image.width*2+12, image.height), 'white')
        for i, panel in enumerate(panels): canvas.paste(panel, (i*(image.width+12), 0))
        canvas.save(OUT/f'{name}.png')
        report = dict(name=name, added=len(record['wall_ids']),
                      free_ends_before=connection_audit(doc)['free_end_count'],
                      free_ends_after=after['wall_connection']['free_end_count'])
        reports.append(report)
        print(json.dumps(report), flush=True)
    (OUT/'metrics.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')


if __name__ == '__main__': main()
