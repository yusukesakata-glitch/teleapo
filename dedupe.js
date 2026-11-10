// 顧客マップ本体の重複判定（addrParts / coreName / isProspectDup）をそのまま移植し、
// テレアポ候補（川崎市・横浜市の見込み店）に対して理由付きで判定する。
const fs = require('fs');
const CUSTOMERS = process.env.HOME + '/workspace/user/files/map_data-3.json';
const PROSPECTS = process.env.HOME + '/workspace/customer-map/full-app/prospects.json';
const TELEAPO_DIR = process.env.HOME + '/workspace/goals/company-customer-map-app/hidden_files/teleapo';

function normalize(s) { return (s||"").replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase().replace(/\s+/g,""); }
function splitName(c) {
    const hw = (t) => (t || "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    if(c.company || c.shop) { if(!(c.shop || "").trim() && (c.company || "").trim()) return { company: "", shop: hw(c.company) }; return { company: hw(c.company || ""), shop: hw(c.shop || "") }; }
    const n = (c.name || "").trim();
    const idx = n.search(/[ 　]/);
    if(idx > 0) {
        const head = n.slice(0, idx), rest = n.slice(idx).trim();
        if(/(株式会社|有限会社|合同会社|合資会社|合名会社|医療法人|社会福祉法人|一般社団法人|公益社団法人|学校法人|NPO法人|（株）|\(株\))/.test(head)) return { company: hw(head), shop: hw(rest) };
    }
    return { company: "", shop: hw(n) };
}
function digitsOf(s) { return (s || "").replace(/\D/g, ""); }
function addrParts(addr) {
    let s = normalize(addr || "");
    const out = { town: "", banchi: "", floor: "", building: "" };
    if(!s) return out;
    const pm = s.match(/^.*?(都|道|府|県)/);
    if(pm) s = s.slice(pm[0].length);
    const tm = s.match(/^[^0-9]+/);
    if(tm) { out.town = tm[0]; s = s.slice(tm[0].length); }
    let rest = s, bm = null;
    if((bm = rest.match(/^(\d+)丁目(\d+)(?:-(\d+))?(?:番地)?(?:(\d+)号)?/))) out.banchi = [bm[1], bm[2], bm[3] || bm[4]].filter(Boolean).join("-");
    else if((bm = rest.match(/^(\d+)-(\d+)(?:-(\d+))?/))) out.banchi = [bm[1], bm[2], bm[3]].filter(Boolean).join("-");
    else if((bm = rest.match(/^(\d+)番地?(?:(\d+)号)?/))) out.banchi = [bm[1], bm[2]].filter(Boolean).join("-");
    if(bm) rest = rest.slice(bm[0].length);
    let fm = null;
    if((fm = s.match(/地下(\d+)階/))) out.floor = "b" + fm[1];
    else if((fm = s.match(/(?:^|[^0-9a-z])(b\d+)f/))) out.floor = fm[1];
    else if((fm = s.match(/(?:^|[^0-9a-z])(b\d+)(?![0-9])/))) out.floor = fm[1];
    else if((fm = s.match(/(?:^|[^0-9])(\d+)階/))) out.floor = fm[1];
    else if((fm = s.match(/(?:^|[^0-9a-z])(\d+)f(?:[^0-9a-z]|$)/))) out.floor = fm[1];
    out.building = rest.replace(/地下?\d+階/, "").replace(/(b\d+|\d+)f/, "").replace(/b\d+$/, "").replace(/\d+号室/, "").replace(/^(ビル|・|、|,|-|‐)+/, "").trim();
    return out;
}
const GENRE_WORDS = ["ガールズバー", "キャバクラ", "スナック", "ラウンジ", "クラブ", "ダイニングバー", "ショットバー", "ホストクラブ", "ガールズ", "メンズ", "レディース", "カラオケ", "居酒屋", "パブ", "カフェ", "バー", "girlsbar", "girl'sbar", "club", "snack", "lounge", "bar", "pub", "cafe"];
function coreName(name) {
    let n = normalize(name || "");
    n = n.replace(/[☆★♪◆◇・.,、。!！?？~〜「」『』()（）\[\]【】]/g, "");
    let changed = true;
    while(changed) {
        changed = false;
        for(const w of GENRE_WORDS) {
            if(n.startsWith(w) && n.length > w.length) { n = n.slice(w.length); changed = true; }
            if(n.endsWith(w) && n.length > w.length) { n = n.slice(0, n.length - w.length); changed = true; }
        }
    }
    n = n.replace(/(本店|支店|駅前店|店)$/, "");
    return n;
}

const db = JSON.parse(fs.readFileSync(CUSTOMERS, 'utf-8'));
const byTown = new Map(); const phones = new Set();
db.forEach(c => {
    const t = digitsOf(c.tel); if(t) phones.add(t);
    const cp = addrParts((c.address || "") + (c.building || ""));
    if(!cp.town) return;
    if(!byTown.has(cp.town)) byTown.set(cp.town, []);
    byTown.get(cp.town).push({ cp: cp, cores: [coreName(c.name), coreName(splitName(c).shop || "")], norms: [normalize(c.name), normalize(splitName(c).shop || "")], raw: c });
});

function dupReason(p) {
    const pn = normalize(p.name);
    if(!pn) return null;
    const pt = digitsOf(p.tel);
    if(pt && phones.has(pt)) return '電話一致';
    const pp = addrParts(p.address);
    if(!pp.town) return null;
    const pcore = coreName(p.name);
    const list = byTown.get(pp.town) || [];
    for(const e of list) {
        const cp = e.cp;
        if(pp.banchi && pp.banchi === cp.banchi && pp.floor && pp.floor === cp.floor && pp.building && cp.building && (pp.building === cp.building || pp.building.includes(cp.building) || cp.building.includes(pp.building))) return '住所一致（番地・階・ビル）';
        if(pcore.length >= 2 && e.cores.some(cc => cc.length >= 2 && (pcore === cc || cc.includes(pcore) || pcore.includes(cc)))) return '店名一致（同一町内）';
        if(pcore && pp.banchi && pp.banchi === cp.banchi && e.cores.some(cc => cc && cc === pcore)) return '店名＋番地一致';
        if(e.norms.some(n => n === pn)) return '店名完全一致';
    }
    return null;
}

const pros = JSON.parse(fs.readFileSync(PROSPECTS, 'utf-8'));
const collected = {};
for(let n = 1; n <= 4; n++) {
    const f = `${TELEAPO_DIR}/batch-${n}-result.json`;
    if(fs.existsSync(f)) for(const r of JSON.parse(fs.readFileSync(f, 'utf-8'))) collected[r.id] = r;
}
const CITIES = ['川崎市', '横浜市'];
const out = {};
let total = 0;
for(const p of pros) {
    if(!CITIES.some(c => (p.address || '').includes(c))) continue;
    total++;
    let reason = dupReason(p);
    if(!reason && collected[p.id] && collected[p.id].tel) {
        reason = dupReason(Object.assign({}, p, { tel: collected[p.id].tel }));
        if(reason) reason += '（収集した番号で判定）';
    }
    if(reason) out[p.id] = { name: p.name, address: p.address, reason };
}
fs.writeFileSync(TELEAPO_DIR + '/dedupe-full.json', JSON.stringify(out, null, 1));
console.log(`対象 ${total} 件 / 重複 ${Object.keys(out).length} 件`);
