#!/usr/bin/env python3
"""NEXAR Directory Map: สร้างข้อมูลคู่มือ DirectoryManual/manual.data.js (Python 3 stdlib ล้วน)

รันจากโฟลเดอร์ Nexar:
    python tools/dirmap.py

สแกนโฟลเดอร์จริง + อ่าน JS import เพื่อสร้างแผนภาพชั้นของโค้ด + รวมกับ DirectoryManual/descriptions.yaml
ถ้ามี error (เช่น path หาย หรือ Core ไป import App/Exporters) จะไม่เขียนไฟล์ และ exit code = 1
"""
import datetime
import json
import os
import re
import sys
from pathlib import Path

SKIP_DIRS = {"bin", "obj", ".vs", ".git", ".idea", "node_modules", "__pycache__"}
IMPORT_RE = re.compile(r"""(?:import\s+(?:[^'"]+?\s+from\s+)?|import\s*\(\s*)['"]([^'"]+)['"]""")


# ------------------------------------------------------------------ Mini YAML parser
# รองรับรูปแบบเดียวกับ descriptions.yaml ของ NEXBIM (top-level list ของ inline { k: v, ... } แบบหลายบรรทัด)
def strip_comment(line: str) -> str:
    in_q = False
    i = 0
    while i < len(line):
        c = line[i]
        if c == '"' and (i == 0 or line[i - 1] != '\\'):
            in_q = not in_q
        elif c == '#' and not in_q:
            return line[:i]
        i += 1
    return line


def split_top(s: str, sep: str = ',') -> list[str]:
    parts, cur, depth, in_q = [], [], 0, False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"' and (i == 0 or s[i - 1] != '\\'):
            in_q = not in_q
            cur.append(c)
        elif not in_q and c in '[{':
            depth += 1
            cur.append(c)
        elif not in_q and c in ']}':
            depth -= 1
            cur.append(c)
        elif not in_q and depth == 0 and c == sep:
            parts.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    tail = ''.join(cur).strip()
    if tail:
        parts.append(tail)
    return parts


def parse_value(raw: str):
    raw = raw.strip()
    if not raw:
        return ""
    if raw.startswith('"') and raw.endswith('"'):
        return json.loads(raw)
    if raw.startswith('[') and raw.endswith(']'):
        inner = raw[1:-1].strip()
        return [parse_value(x) for x in split_top(inner, ',')] if inner else []
    if raw == 'true':
        return True
    if raw == 'false':
        return False
    return raw


def parse_inline_map(text: str) -> dict:
    text = text.strip()
    if not (text.startswith('{') and text.endswith('}')):
        raise ValueError(f"Expected '{{...}}', got: {text[:60]}")
    out = {}
    for item in split_top(text[1:-1], ','):
        if ':' not in item:
            continue
        k, v = item.split(':', 1)
        out[k.strip()] = parse_value(v)
    return out


def load_descriptions(path: Path) -> dict:
    sections: dict[str, list[dict]] = {}
    cur_sec = None
    buf = ""
    depth = 0
    in_q = False

    def flush():
        nonlocal buf
        s = buf.strip()
        if s:
            if s.startswith('- '):
                s = s[2:].strip()
            sections.setdefault(cur_sec, []).append(parse_inline_map(s))
        buf = ""

    for lineno, raw_line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = strip_comment(raw_line).rstrip()
        if not line.strip():
            continue
        if not buf and not line[0].isspace() and line.endswith(':'):
            cur_sec = line[:-1].strip()
            sections.setdefault(cur_sec, [])
            continue
        if cur_sec is None:
            raise ValueError(f"Line {lineno}: entry outside section")
        if not buf and line.lstrip().startswith('- '):
            buf = line.lstrip()
        else:
            buf += ' ' + line.strip()
        # track brace balance
        depth = 0
        in_q = False
        for idx, ch in enumerate(buf):
            if ch == '"' and (idx == 0 or buf[idx - 1] != '\\'):
                in_q = not in_q
            elif not in_q:
                if ch in '{[':
                    depth += 1
                elif ch in '}]':
                    depth -= 1
        if depth == 0 and not in_q:
            flush()
    if buf.strip():
        raise ValueError("Unclosed block at end of descriptions.yaml")
    return sections


# ------------------------------------------------------------------ Tree builder
def norm_rel(p: str) -> str:
    s = p.replace('\\', '/').strip('/')
    return '.' if s in ('', '.') else s


def find_node(node: dict, target_path: str):
    if node['path'] == target_path:
        return node
    for child in node.get('c') or []:
        hit = find_node(child, target_path)
        if hit:
            return hit
    return None


def build_tree(root: Path, desc: dict, errors: list[str], warnings: list[str]) -> dict:
    paths_map = {norm_rel(x['path']): x for x in desc.get('paths', [])}
    planned_map = {norm_rel(x['path']): x for x in desc.get('planned', [])}
    used: set[str] = set()

    def apply_meta(node: dict, info: dict):
        if info.get('s'):
            node['s'] = info['s']
        for k in ('p', 'd', 'r', 'e'):
            if info.get(k):
                node[k] = info[k]

    def make(full: Path, is_dir: bool) -> dict:
        rel = norm_rel(str(full.relative_to(root))) if full != root else '.'
        node = {
            'n': 'Nexar' if rel == '.' else full.name,
            'path': 'Nexar' if rel == '.' else f'Nexar/{rel}',
            's': 'done',
            'dir': is_dir,
        }
        info = paths_map.get(rel)
        if info:
            used.add(rel)
            apply_meta(node, info)
        elif is_dir:
            node['miss'] = True
            warnings.append(f"no description: {rel}/")

        if (not info or not info.get('s')) and node['n'].lower().endswith('.data.js'):
            node['s'] = 'gen'

        if is_dir:
            kids = []
            entries = sorted(full.iterdir(), key=lambda x: x.name.lower())
            for d in entries:
                if d.is_dir() and d.name not in SKIP_DIRS:
                    kids.append(make(d, True))
            for f in entries:
                if f.is_file():
                    kids.append(make(f, False))
            node['c'] = kids
        return node

    tree = make(root, True)

    for stale in sorted(set(paths_map.keys()) - used):
        errors.append(f"descriptions.yaml: path '{stale}' does not exist on disk")

    for rel in sorted(planned_map.keys(), key=len):
        info = planned_map[rel]
        if (root / rel).exists():
            errors.append(f"descriptions.yaml: planned '{rel}' now exists on disk, move it to paths:")
            continue
        parent_rel = rel.rsplit('/', 1)[0] if '/' in rel else '.'
        parent = find_node(tree, 'Nexar' if parent_rel == '.' else f'Nexar/{parent_rel}')
        if not parent:
            errors.append(f"descriptions.yaml: planned '{rel}' has no parent folder")
            continue
        node = {
            'n': rel.rsplit('/', 1)[-1],
            'path': f'Nexar/{rel}',
            's': 'planned',
            'dir': True,
        }
        apply_meta(node, info)
        kids = parent.setdefault('c', [])
        idx = next((i for i, x in enumerate(kids) if not x.get('dir')), len(kids))
        kids.insert(idx, node)

    return tree


# ------------------------------------------------------------------ Layer builder (from real JS imports)
def layer_of_rel(rel: str) -> str | None:
    parts = rel.split('/')
    if len(parts) < 3 or parts[0] != 'src':
        return None
    if parts[1] == 'Exporters':
        return 'Nexar.Exporters'
    if parts[1] in ('Core', 'App') and len(parts) >= 3:
        return parts[2]
    return None


def layer_folder_of(layer_id: str, src_root: Path) -> str | None:
    if layer_id == 'Nexar.Exporters':
        return 'src/Exporters'
    for group in ('Core', 'App'):
        if (src_root / group / layer_id).is_dir():
            return f'src/{group}/{layer_id}'
    return None


def build_layers(root: Path, desc: dict, errors: list[str], warnings: list[str]) -> list[dict]:
    src = root / 'src'
    layers: dict[str, dict] = {}
    uses_map: dict[str, set[str]] = {}

    if src.is_dir():
        for js_file in sorted(src.rglob('*.js')):
            rel = norm_rel(str(js_file.relative_to(root)))
            lid = layer_of_rel(rel)
            if not lid:
                continue
            folder = layer_folder_of(lid, src)
            if lid not in layers:
                layers[lid] = {'id': lid, 't': '', 'd': '', 'pk': [folder] if folder else [], 'uses': [], 'planned': False, 'depth': 0}
                uses_map[lid] = set()
            text = js_file.read_text(encoding='utf-8')
            for m in IMPORT_RE.finditer(text):
                spec = m.group(1)
                if not spec.startswith('.'):
                    continue
                target = (js_file.parent / spec).resolve()
                try:
                    t_rel = norm_rel(str(target.relative_to(root)))
                except ValueError:
                    continue
                tlid = layer_of_rel(t_rel)
                if tlid and tlid != lid:
                    uses_map[lid].add(tlid)
                    if folder and folder.startswith('src/Core/') and not t_rel.startswith('src/Core/'):
                        errors.append(f"layer rule: {lid} (Core) must not import {t_rel}")

    for lid, u in uses_map.items():
        layers[lid]['uses'] = sorted(u)

    for li in desc.get('layers', []):
        lid = li['id']
        is_planned = bool(li.get('planned'))
        if lid in layers:
            layers[lid]['t'] = li.get('t', lid)
            layers[lid]['d'] = li.get('d', '')
            if is_planned:
                errors.append(f"layer '{lid}' exists on disk now, remove planned: true")
        elif is_planned:
            layers[lid] = {
                'id': lid,
                't': li.get('t', lid),
                'd': li.get('d', ''),
                'pk': [li['folder']] if li.get('folder') else [],
                'uses': list(li.get('uses') or []),
                'planned': True,
                'depth': 0,
            }
        else:
            errors.append(f"descriptions.yaml: layer '{lid}' has no JS files (set planned: true if not built yet)")

    for l in layers.values():
        if not l['t']:
            l['t'] = l['id']
            warnings.append(f"no layer description: {l['id']}")
        for u in l['uses']:
            if u not in layers:
                errors.append(f"layer '{l['id']}' uses unknown '{u}'")

    memo: dict[str, int] = {}

    def depth(lid: str, stack: set[str]) -> int:
        if lid in memo:
            return memo[lid]
        if lid in stack:
            errors.append(f"layer cycle at {lid}")
            return 0
        stack.add(lid)
        uses = [u for u in layers[lid]['uses'] if u in layers]
        d = 0 if not uses else 1 + max(depth(u, stack) for u in uses)
        stack.remove(lid)
        memo[lid] = d
        return d

    for lid in layers:
        layers[lid]['depth'] = depth(lid, set())

    return sorted(layers.values(), key=lambda x: (-x['depth'], x['id']))


# ------------------------------------------------------------------ main
def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    manual_dir = root / 'DirectoryManual'
    out_path = manual_dir / 'manual.data.js'
    if not out_path.exists():
        out_path.write_text('', encoding='utf-8')

    errors: list[str] = []
    warnings: list[str] = []
    try:
        desc = load_descriptions(manual_dir / 'descriptions.yaml')
    except Exception as e:
        print(f"YAML error: {e}", file=sys.stderr)
        return 1

    tree = build_tree(root, desc, errors, warnings)
    layers = build_layers(root, desc, errors, warnings)

    def check_path(label: str, rel: str):
        if rel in ('', '.'):
            return
        if not find_node(tree, f"Nexar/{norm_rel(rel)}"):
            errors.append(f"descriptions.yaml: {label} points to '{rel}' which does not exist")

    for p in desc.get('proposals', []):
        check_path(f"proposal {p.get('id')}", p.get('where', ''))
    for m in desc.get('mechanisms', []):
        check_path(f"mechanism '{m.get('t')}'", m.get('where', ''))
    for t in desc.get('tasks', []):
        check_path(f"task '{t.get('t')}'", t.get('go', ''))
    for f in desc.get('filemap', []):
        for rel in list(f.get('core') or []) + list(f.get('cfg') or []):
            check_path(f"filemap '{f.get('t')}'", rel)

    for w in warnings:
        print(f"warning: {w}")
    if errors:
        for e in errors:
            print(f"error: {e}", file=sys.stderr)
        print(f"{len(errors)} error(s): manual.data.js not written", file=sys.stderr)
        return 1

    def prefix(rel: str) -> str:
        r = norm_rel(rel)
        return 'Nexar' if r == '.' else f'Nexar/{r}'

    data = {
        'updated': datetime.date.today().isoformat(),
        'tree': tree,
        'layers': layers,
        'tasks': [{'t': t['t'], 'go': prefix(t['go']), 's': t.get('steps', []), 'cmd': t.get('cmd')} for t in desc.get('tasks', [])],
        'rules': [{'t': r['t'], 'd': r['d']} for r in desc.get('rules', [])],
        'glossary': [{'k': g['k'], 'v': g['v'], 'r': g.get('r', '')} for g in desc.get('glossary', [])],
        'proposals': [{
            'id': p['id'], 't': p['t'], 's': p['s'], 'from': p.get('from'), 'why': p.get('why'),
            'design': p['design'], 'where': '' if p.get('where', '.') == '.' else prefix(p['where']),
            'layer': p.get('layer'), 'steps': p.get('steps', []), 'ask': p.get('ask', []), 'depends': p.get('depends', []),
        } for p in desc.get('proposals', [])],
        'roadmap': [{
            'id': s['id'], 't': s['t'], 's': s['s'], 'why': s.get('why'),
            'b': s.get('buttons', []), 'check': s.get('check', []), 'props': s.get('props', []),
        } for s in desc.get('roadmap', [])],
        'filemap': [{
            'st': f.get('st'), 't': f['t'], 'm': f.get('m'),
            'core': [prefix(p) for p in f.get('core', [])],
            'cfg': [prefix(p) for p in f.get('cfg', [])],
            'proto': f.get('proto', []),
        } for f in desc.get('filemap', [])],
        'mechanisms': [{
            't': m['t'], 's': m['s'], 'what': m['what'], 'revit': m.get('revit'),
            'where': '' if m.get('where', '.') == '.' else prefix(m['where']), 'next': m.get('next'),
        } for m in desc.get('mechanisms', [])],
        'warnings': warnings,
    }

    out_path.write_text(
        "// สร้างโดย tools/dirmap.py: ห้ามแก้มือ (แก้ descriptions.yaml แล้วรันใหม่)\n"
        "window.NEXAR_MANUAL = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding='utf-8',
    )

    def count(node: dict, want_dir: bool) -> int:
        me = 1 if (node.get('dir') == want_dir and node.get('s') != 'planned') else 0
        return me + sum(count(ch, want_dir) for ch in node.get('c') or [])

    print(f"OK  {count(tree, True)} folders, {count(tree, False)} files, {len(layers)} layers, {len(warnings)} warning(s)")
    print(f"-> {out_path}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
