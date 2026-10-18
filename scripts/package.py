#!/usr/bin/env python3
"""Validate the distributable skill and create a versioned ZIP with checksums."""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import pathlib
import re
import urllib.parse
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
NAME = 'code-video-studio'
EXCLUDED = {'.git', 'node_modules', '__pycache__', '.venv', 'outputs', 'dist'}


def included_files():
    return sorted(p for p in ROOT.rglob('*') if p.is_file()
                  and not any(part in EXCLUDED for part in p.relative_to(ROOT).parts)
                  and p.name not in {'MANIFEST.sha256', '.env', '.DS_Store'}
                  and p.suffix not in {'.pyc', '.zip'})


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate():
    required = ['SKILL.md', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                'VALIDATION.md', 'references/intake.md', 'references/selection.md',
                'references/production-prompt.md', 'references/production.md',
                'references/quality.md', 'assets/brief.schema.json',
                'assets/runtime/package.json', 'assets/runtime/package-lock.json',
                'assets/runtime/demo/index.html', 'scripts/video.mjs', 'scripts/README.md']
    for name in required:
        if not (ROOT / name).is_file():
            raise ValueError(f'Missing required file: {name}')
    skill = (ROOT / 'SKILL.md').read_text(encoding='utf8')
    if not skill.startswith('---\nname: code-video-studio\ndescription:'):
        raise ValueError('Skill name or frontmatter is invalid')
    catalog = json.loads((ROOT / 'references/library/catalog.json').read_text(encoding='utf8'))
    entries = catalog['entries']
    counts = collections.Counter(row['family'] for row in entries)
    if len(entries) != 66 or sorted(counts.values()) != [15, 51]:
        raise ValueError(f'Unexpected style library counts: {dict(counts)}')
    for row in entries:
        path = (ROOT / row['path']).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file() or digest(path.read_bytes()) != row['sha256']:
            raise ValueError(f'Invalid style file: {row["path"]}')
    sources = json.loads((ROOT / 'references/library/SOURCE_FILES.json').read_text(encoding='utf8'))['files']
    if len(sources) != 72:
        raise ValueError('Expected 72 upstream documentation and license files')
    for row in sources:
        path = (ROOT / row['path']).resolve()
        if not path.is_relative_to(ROOT):
            raise ValueError(f'Upstream path escapes package: {row["path"]}')
        data = path.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if digest(data) != row['sha256'] or blob != row['upstream']['blob_sha']:
            raise ValueError(f'Changed upstream file: {row["path"]}')
    files = included_files()
    for path in files:
        if path.suffix in {'.md', '.json', '.yaml', '.yml', '.mjs', '.py', '.html'} or path.name == 'LICENSE':
            text = path.read_text(encoding='utf8')
            if re.search(r'gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}', text):
                raise ValueError(f'Possible embedded credential: {path.relative_to(ROOT)}')
            if re.search(r'[A-Za-z]:[\\/](?:Users|VideoTools|2Vibe)', text):
                raise ValueError(f'Machine-specific path: {path.relative_to(ROOT)}')
        if path.suffix == '.md' and not path.is_relative_to(ROOT / 'references/library'):
            for link in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf8')):
                if re.match(r'https?://|#', link):
                    continue
                target = urllib.parse.unquote(link.split('#', 1)[0].strip('<>'))
                if not (path.parent / target).resolve().is_file():
                    raise ValueError(f'Broken package link: {path.relative_to(ROOT)} -> {target}')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate files and existing manifest without writing')
    args = parser.parse_args()
    files = validate()
    manifest_text = ''.join(f'{digest(p.read_bytes())}  {p.relative_to(ROOT).as_posix()}\n' for p in files)
    manifest = ROOT / 'MANIFEST.sha256'
    if args.check:
        if not manifest.is_file() or manifest.read_text(encoding='utf8') != manifest_text:
            raise ValueError('Manifest differs from package contents; run python scripts/package.py')
        print(f'Validated {len(files)} files, 66 styles, 72 unchanged upstream files, links and manifest.')
        return
    manifest.write_text(manifest_text, encoding='utf8')
    version = json.loads((ROOT / 'assets/runtime/package.json').read_text(encoding='utf8'))['version']
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    archive = dist / f'{NAME}-{version}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files + [manifest]:
            info = zipfile.ZipInfo(f'{NAME}/{p.relative_to(ROOT).as_posix()}', date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, p.read_bytes())
    checksum = dist / f'{NAME}-{version}.sha256'
    checksum.write_text(f'{digest(archive.read_bytes())}  {archive.name}\n', encoding='utf8')
    with zipfile.ZipFile(archive) as z:
        for p in files + [manifest]:
            if z.read(f'{NAME}/{p.relative_to(ROOT).as_posix()}') != p.read_bytes():
                raise ValueError(f'ZIP round trip mismatch: {p.relative_to(ROOT)}')
    print(json.dumps({'archive': archive.name, 'files': len(files) + 1,
                      'bytes': archive.stat().st_size, 'sha256': digest(archive.read_bytes())}, indent=2))


if __name__ == '__main__':
    main()
