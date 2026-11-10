#!/usr/bin/env python3
"""テレアポリストの data.js を生成する。
重複判定は顧客マップ本体のロジック（dedupe.js / Node）を必ず先に実行し、
その結果（dedupe-full.json）で除外してから、収集結果をマージして出力する。
dedupe が失敗したら古い判定で出さずに中止する。
"""
import json, re, os, subprocess, sys

BASE = os.path.dirname(os.path.abspath(__file__))
TELEAPO_DIR = os.path.expanduser('~/workspace/goals/company-customer-map-app/hidden_files/teleapo')
PROSPECTS = os.path.expanduser('~/workspace/customer-map/full-app/prospects.json')
CITIES = ['川崎市', '横浜市']


def digits(t):
    return re.sub(r'\D', '', str(t or ''))


def area_of(p):
    a = p.get('address', '')
    if '川崎市' in a:
        return '川崎'
    if '中区' in a or '関内' in (p.get('station', '') + a):
        return '横浜・関内'
    return '横浜'


def main():
    r = subprocess.run(['node', os.path.join(BASE, 'dedupe.js')], capture_output=True, text=True)
    if r.returncode != 0:
        print('dedupe.js 失敗。中止します。', r.stderr[-500:])
        sys.exit(1)
    print(r.stdout.strip())
    dup_ids = set(json.load(open(os.path.join(TELEAPO_DIR, 'dedupe-full.json'), encoding='utf-8')).keys())

    pros = json.load(open(PROSPECTS, encoding='utf-8'))
    collected = {}
    for n in range(1, 5):
        f = os.path.join(TELEAPO_DIR, f'batch-{n}-result.json')
        if os.path.exists(f):
            for rec in json.load(open(f, encoding='utf-8')):
                collected[rec['id']] = rec
    jobcheck = {}
    for n in range(1, 5):
        f = os.path.join(TELEAPO_DIR, f'jobcheck-{n}-result.json')
        if os.path.exists(f):
            for rec in json.load(open(f, encoding='utf-8')):
                jobcheck[rec['id']] = rec

    out, excluded = [], 0
    for p in pros:
        if not any(c in (p.get('address') or '') for c in CITIES):
            continue
        if p['id'] in dup_ids:
            excluded += 1
            continue
        r = collected.get(p['id'], {})
        tel = r.get('tel') or p.get('tel') or ''
        tel_type = r.get('tel_type') or ('携帯' if re.match(r'0[789]0', digits(tel)) else '店電')
        out.append({
            'id': p['id'],
            'name': p['name'],
            'genre': p.get('genre', ''),
            'address': p.get('address', ''),
            'station': p.get('station', ''),
            'area': area_of(p),
            'tel': tel,
            'telType': tel_type if tel else '',
            'hours': r.get('hours', ''),
            'openFrom': r.get('open_from', ''),
            'sourceUrl': r.get('hours_source_url') or r.get('tel_source_url') or p.get('sourceUrl', ''),
            'jobUrl': (jobcheck.get(p['id'], {}).get('job_url') or p.get('jobUrl') or ''),
            'jobSource': (jobcheck.get(p['id'], {}).get('job_source') or p.get('jobSource') or ''),
        })

    out.sort(key=lambda s: (s['area'], s['address'], s['name']))
    with open(os.path.join(BASE, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('window.TELEAPO_DATA = ')
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write(';\n')
    with_hours = sum(1 for s in out if s['hours'])
    with_tel = sum(1 for s in out if s['tel'])
    with_job = sum(1 for s in out if s['jobUrl'])
    print(f'掲載 {len(out)} 件（既存顧客と重複で除外 {excluded} 件） / 営業時間あり {with_hours} / 電話あり {with_tel} / 求人URLあり {with_job}')


if __name__ == '__main__':
    main()
