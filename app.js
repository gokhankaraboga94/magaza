import {
  auth,
  db,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue
} from "./firebase.js";

const isAdminPage = !!document.getElementById('appScreen');

// ── STATE ──────────────────────────────────────────────────────────────────
let records = {};
let editingId = null;
let currentView = 'list'; // list | form | detail
let hasSyncedPublic = false;

// ── HELPERS ───────────────────────────────────────────────────────────────
function random5Digit() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

function normalizeServisNo(input) {
  const v = (input || '').toString().trim().toUpperCase();
  if (!v) return '';
  if (/^\d{5}$/.test(v)) return 'M' + v;
  if (/^M\d{5}$/.test(v)) return v;
  return v;
}

function servisNoExistsLocal(servisNo) {
  const n = normalizeServisNo(servisNo);
  return Object.values(records).some(r => normalizeServisNo(r?.servisNo) === n);
}

async function genServisNo() {
  for (let i = 0; i < 30; i++) {
    const servisNo = 'M' + random5Digit();
    if (servisNoExistsLocal(servisNo)) continue;
    try {
      const snap = await get(ref(db, 'servis_public/' + servisNo));
      if (snap.exists()) continue;
    } catch (_) {
      // ignore
    }
    return servisNo;
  }
  return 'M' + random5Digit();
}
function ts() { return new Date().toLocaleString('tr-TR'); }
function statusLabel(s) {
  const m = { onarim:'🔧 Onarımda', parca:'📦 Parça Bekliyor', test:'🔬 Test Ediliyor', hazir:'✅ Hazır', teslim:'🎁 Teslim Edildi' };
  return m[s] || s;
}
function statusColor(s) {
  const m = { onarim:'#f59e0b', parca:'#8b5cf6', test:'#3b82f6', hazir:'#10b981', teslim:'#6b7280' };
  return m[s] || '#6b7280';
}

function toPublicRecord(r) {
  return {
    servisNo: r.servisNo || '',
    durum: r.durum || '',
    olusturma: r.olusturma || '',
    guncelleme: r.guncelleme || '',
    ad: r.ad || '',
    soyad: r.soyad || '',
    tel: r.tel || '',
    marka: r.marka || '',
    model: r.model || '',
    imei: r.imei || '',
    renk: r.renk || '',
    aksesuar: r.aksesuar || '',
    degistirilenparca: r.degistirilenparca || '',
    odemeYontemi: r.odemeYontemi || '',
    alinanOdeme: r.alinanOdeme ?? '',
    odemeTarihi: r.odemeTarihi || ''
  };
}

async function upsertPublic(servisNo, record) {
  if (!servisNo) return;
  await set(ref(db, 'servis_public/' + servisNo), toPublicRecord(record));
}

async function removePublic(servisNo) {
  if (!servisNo) return;
  await remove(ref(db, 'servis_public/' + servisNo));
}

// ── AUTH ──────────────────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('loginErr');
  btn.disabled = true; btn.textContent = 'Giriş yapılıyor…';
  err.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    err.textContent = 'E-posta veya şifre hatalı.';
    btn.disabled = false; btn.textContent = 'Giriş Yap';
  }
};

window.doLogout = async function() {
  await signOut(auth);
};

if (isAdminPage) {
  onAuthStateChanged(auth, user => {
    const loginScreen = document.getElementById('loginScreen');
    const appScreen = document.getElementById('appScreen');
    if (loginScreen) loginScreen.style.display = user ? 'none' : 'flex';
    if (appScreen) appScreen.style.display   = user ? 'block' : 'none';
    if (user) {
      const emailEl = document.getElementById('userEmail');
      if (emailEl) emailEl.textContent = user.email;
      loadRecords();
    }
  });
}

// ── DB ────────────────────────────────────────────────────────────────────
function loadRecords() {
  const r = ref(db, 'servis');
  onValue(r, snap => {
    records = snap.val() || {};
    if (!hasSyncedPublic) {
      hasSyncedPublic = true;
      Object.values(records).forEach(rec => {
        if (rec && rec.servisNo) upsertPublic(rec.servisNo, rec);
      });
    }
    renderList();
  });
}

async function saveRecord(data) {
  if (editingId) {
    const existing = getRecordByKey(editingId) || {};
    const updated = { ...existing, ...data, guncelleme: ts() };
    await update(ref(db, 'servis/' + editingId), { ...data, guncelleme: updated.guncelleme });
    await upsertPublic(existing.servisNo, updated);
    showToast('Kayıt güncellendi ✓');
  } else {
    const newRef = push(ref(db, 'servis'));
    const id = await genServisNo();
    const created = { ...data, firebaseKey: newRef.key, servisNo: id, olusturma: ts() };
    await set(newRef, created);
    await upsertPublic(id, created);
    showToast('Yeni kayıt oluşturuldu ✓');
  }
  showView('list');
}

window.deleteRecord = async function(key) {
  if (!confirm('Bu kaydı silmek istediğinizden emin misiniz?')) return;
  const existing = getRecordByKey(key) || {};
  await remove(ref(db, 'servis/' + key));
  await removePublic(existing.servisNo);
  showToast('Kayıt silindi.');
  showView('list');
};

window.updateStatus = async function(key, status) {
  const existing = getRecordByKey(key) || {};
  await update(ref(db, 'servis/' + key), { durum: status, guncelleme: ts() });
  if (existing.servisNo) {
    await update(ref(db, 'servis_public/' + existing.servisNo), { durum: status, guncelleme: ts() });
  }
  showToast('Durum güncellendi ✓');
};

// ── PUBLIC QUERY (NO LOGIN) ───────────────────────────────────────────────
window.doPublicQuery = async function() {
  const input = document.getElementById('q_servisNo');
  const btn = document.getElementById('queryBtn');
  const err = document.getElementById('queryErr');
  const out = document.getElementById('queryResult');
  if (!input || !btn || !err || !out) return;

  const servisNo = normalizeServisNo(input.value);
  err.textContent = '';
  out.style.display = 'none';
  out.innerHTML = '';

  if (!servisNo) {
    err.textContent = 'Lütfen Servis No giriniz.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sorgulanıyor…';
  try {
    const snap = await get(ref(db, 'servis_public/' + servisNo));
    if (!snap.exists()) {
      err.textContent = 'Kayıt bulunamadı.';
      return;
    }
    const r = snap.val() || {};
    out.innerHTML = `
      <h3>Servis Durumu</h3>
      <div class="q-row"><span>Servis No</span><strong>${r.servisNo || servisNo}</strong></div>
      <div class="q-row"><span>Durum</span><strong>${statusLabel(r.durum)}</strong></div>
      <div class="q-row"><span>Son Güncelleme</span><strong>${r.guncelleme || r.olusturma || '—'}</strong></div>
      <h3 style="margin-top:1rem">Müşteri Bilgileri</h3>
      <div class="q-row"><span>Ad Soyad</span><strong>${(r.ad||'') + ' ' + (r.soyad||'')}</strong></div>
      <div class="q-row"><span>Telefon</span><strong>${r.tel || '—'}</strong></div>
      <h3 style="margin-top:1rem">Cihaz Bilgileri</h3>
      <div class="q-row"><span>Marka / Model</span><strong>${(r.marka||'—') + ' ' + (r.model||'')}</strong></div>
      <div class="q-row"><span>IMEI</span><strong>${r.imei || '—'}</strong></div>
      <div class="q-row"><span>Renk</span><strong>${r.renk || '—'}</strong></div>
      <div class="q-row"><span>Aksesuar</span><strong>${r.aksesuar || '—'}</strong></div>
      <h3 style="margin-top:1rem">Parça & Ödeme</h3>
      <div class="q-row"><span>Değişen Parça</span><strong>${r.degistirilenparca || '—'}</strong></div>
      <div class="q-row"><span>Ödenen</span><strong>${(r.alinanOdeme !== '' && r.alinanOdeme != null) ? (r.alinanOdeme + ' ₺') : '—'}</strong></div>
      ${(r.odemeYontemi || r.odemeTarihi) ? `
      <div class="q-row"><span>Ödeme Yöntemi</span><strong>${r.odemeYontemi || '—'}</strong></div>
      <div class="q-row"><span>Ödeme Tarihi</span><strong>${r.odemeTarihi || '—'}</strong></div>
      ` : ''}
    `;
    out.style.display = 'block';
  } catch (e) {
    err.textContent = 'Sorgu yapılamadı. Lütfen tekrar deneyiniz.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sorgula';
  }
};

window.doQueryKey = function(e) {
  if (e.key === 'Enter') window.doPublicQuery();
};

// ── VIEWS ─────────────────────────────────────────────────────────────────
function showView(v, key) {
  currentView = v;
  document.getElementById('viewList').style.display   = v === 'list'   ? 'block' : 'none';
  document.getElementById('viewForm').style.display   = v === 'form'   ? 'block' : 'none';
  document.getElementById('viewDetail').style.display = v === 'detail' ? 'block' : 'none';

  if (v === 'form') {
    editingId = key || null;
    populateForm(key ? getRecordByKey(key) : null);
  }
  if (v === 'detail' && key) renderDetail(key);
  if (v === 'list') renderList();
}
window.showView = showView;

function getRecordByKey(key) {
  return Object.values(records).find(r => r.firebaseKey === key) || null;
}

// ── LIST VIEW ─────────────────────────────────────────────────────────────
function renderList() {
  const search = (document.getElementById('searchBox')?.value || '').toLowerCase();
  const filterStatus = document.getElementById('filterStatus')?.value || '';
  const tbody = document.getElementById('recordsTbody');
  if (!tbody) return;

  let rows = Object.values(records).sort((a,b) => (b.olusturma||'').localeCompare(a.olusturma||''));

  if (search) rows = rows.filter(r =>
    (r.ad+' '+r.soyad+' '+r.tel+' '+r.marka+' '+r.model+' '+r.servisNo+'').toLowerCase().includes(search)
  );
  if (filterStatus) rows = rows.filter(r => r.durum === filterStatus);

  document.getElementById('totalCount').textContent = rows.length;

  tbody.innerHTML = rows.map(r => `
    <tr onclick="showView('detail','${r.firebaseKey}')" style="cursor:pointer">
      <td><span class="badge" style="background:${statusColor(r.durum)}20;color:${statusColor(r.durum)};border:1px solid ${statusColor(r.durum)}40">${statusLabel(r.durum)}</span></td>
      <td><strong>${r.servisNo||'—'}</strong></td>
      <td>${r.ad||''} ${r.soyad||''}</td>
      <td>${r.tel||'—'}</td>
      <td>${r.marka||'—'} ${r.model||''}</td>
      <td>${r.ariza||'—'}</td>
      <td>${r.olusturma||'—'}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        <button class="btn-sm btn-edit" onclick="showView('form','${r.firebaseKey}')">✏️ Düzenle</button>
        <button class="btn-sm btn-del" onclick="deleteRecord('${r.firebaseKey}')">🗑️</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#94a3b8">Kayıt bulunamadı</td></tr>`;
}

document.addEventListener('input', e => { if (e.target.id === 'searchBox') renderList(); });
document.addEventListener('change', e => { if (e.target.id === 'filterStatus') renderList(); });

// ── FORM VIEW ─────────────────────────────────────────────────────────────
function populateForm(rec) {
  const fields = ['ad','soyad','tel','tc','adres','marka','model','imei','renk','ariza','aksesuar',
                  'notlar','teknikNotlar','degistirilenparca','durum',
                  'odemeYontemi','maliyet','alinanOdeme','odemeTarihi'];
  fields.forEach(f => {
    const el = document.getElementById('f_'+f);
    if (el) el.value = rec ? (rec[f]||'') : (f==='durum' ? 'onarim' : '');
  });
  document.getElementById('formTitle').textContent = rec ? '✏️ Kaydı Düzenle' : '➕ Yeni Servis Kaydı';
  document.getElementById('servisNoDisplay').textContent = rec ? ('Servis No: ' + rec.servisNo) : 'Yeni kayıt – otomatik atanacak';
}

window.submitForm = function(e) {
  e.preventDefault();
  const get = id => document.getElementById('f_'+id)?.value || '';
  const data = {
    ad: get('ad'), soyad: get('soyad'), tel: get('tel'), tc: get('tc'), adres: get('adres'),
    marka: get('marka'), model: get('model'), imei: get('imei'), renk: get('renk'),
    ariza: get('ariza'), aksesuar: get('aksesuar'), notlar: get('notlar'),
    teknikNotlar: get('teknikNotlar'), degistirilenparca: get('degistirilenparca'),
    durum: get('durum'),
    // internal fields
    odemeYontemi: get('odemeYontemi'), maliyet: get('maliyet'),
    alinanOdeme: get('alinanOdeme'), odemeTarihi: get('odemeTarihi')
  };
  saveRecord(data);
};

// ── DETAIL VIEW ───────────────────────────────────────────────────────────
function renderDetail(key) {
  const r = getRecordByKey(key);
  if (!r) return;
  const el = document.getElementById('detailContent');
  el.innerHTML = `
    <div class="detail-header">
      <div>
        <span class="badge lg" style="background:${statusColor(r.durum)}20;color:${statusColor(r.durum)};border:1px solid ${statusColor(r.durum)}40">${statusLabel(r.durum)}</span>
        <h2>Servis No: ${r.servisNo}</h2>
        <p style="color:#94a3b8;font-size:.85rem">Oluşturma: ${r.olusturma||'—'} ${r.guncelleme ? '· Güncelleme: '+r.guncelleme : ''}</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn-sm btn-edit" onclick="showView('form','${key}')">✏️ Düzenle</button>
        <button class="btn-sm btn-print" onclick="printReceipt('${key}')">🖨️ Fiş Yazdır</button>
        <button class="btn-sm btn-del" onclick="deleteRecord('${key}')">🗑️ Sil</button>
      </div>
    </div>

    <div class="detail-status-bar">
      ${['onarim','parca','test','hazir','teslim'].map(s=>`
        <button class="status-btn ${r.durum===s?'active':''}" style="--sc:${statusColor(s)}"
          onclick="updateStatus('${key}','${s}')">
          ${statusLabel(s)}
        </button>`).join('')}
    </div>

    <div class="detail-grid">
      <div class="detail-card">
        <h3>👤 Müşteri Bilgileri</h3>
        <div class="detail-row"><span>Ad Soyad</span><strong>${r.ad||''} ${r.soyad||''}</strong></div>
        <div class="detail-row"><span>Telefon</span><strong>${r.tel||'—'}</strong></div>
        <div class="detail-row"><span>TC No</span><strong>${r.tc||'—'}</strong></div>
        <div class="detail-row"><span>Adres</span><strong>${r.adres||'—'}</strong></div>
      </div>
      <div class="detail-card">
        <h3>📱 Cihaz Bilgileri</h3>
        <div class="detail-row"><span>Marka / Model</span><strong>${r.marka||'—'} ${r.model||''}</strong></div>
        <div class="detail-row"><span>IMEI</span><strong style="font-family:'JetBrains Mono'">${r.imei||'—'}</strong></div>
        <div class="detail-row"><span>Renk</span><strong>${r.renk||'—'}</strong></div>
        <div class="detail-row"><span>Aksesuar</span><strong>${r.aksesuar||'—'}</strong></div>
      </div>
      <div class="detail-card full">
        <h3>🔧 Arıza & Notlar</h3>
        <div class="detail-row"><span>Arıza</span><strong>${r.ariza||'—'}</strong></div>
        <div class="detail-row"><span>Müşteri Notu</span><strong>${r.notlar||'—'}</strong></div>
      </div>
      <div class="detail-card full">
        <h3>🛠️ Teknik Servis (İç Kullanım)</h3>
        <div class="detail-row"><span>Teknik Notlar</span><strong>${r.teknikNotlar||'—'}</strong></div>
        <div class="detail-row"><span>Değiştirilen Parça</span><strong>${r.degistirilenparca||'—'}</strong></div>
      </div>
      <div class="detail-card full internal-card">
        <h3>💳 Ödeme Bilgileri <em>(Müşteri fişinde görünmez)</em></h3>
        <div class="detail-row"><span>Ödeme Yöntemi</span><strong>${r.odemeYontemi||'—'}</strong></div>
        <div class="detail-row"><span>Maliyet</span><strong>${r.maliyet ? r.maliyet+' ₺' : '—'}</strong></div>
        <div class="detail-row"><span>Alınan Ödeme</span><strong>${r.alinanOdeme ? r.alinanOdeme+' ₺' : '—'}</strong></div>
        <div class="detail-row"><span>Ödeme Tarihi</span><strong>${r.odemeTarihi||'—'}</strong></div>
      </div>
    </div>`;
}

// ── PRINT RECEIPT ─────────────────────────────────────────────────────────
window.printReceipt = function(key) {
  const r = getRecordByKey(key);
  if (!r) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="tr"><head>
<meta charset="UTF-8">
<title>Servis Fişi – ${r.servisNo}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%}
  body{font-family:'DM Sans',sans-serif;font-size:9pt;color:#111;background:#fff}

  @page{size:A4;margin:7mm}

  .page{width:210mm;position:relative;padding:7mm 9mm}
  .page-break{page-break-after:always;break-after:page}

  .logo-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #3730a3;padding-bottom:6px;margin-bottom:8px}
  .brand-block{display:flex;align-items:center;gap:8px}
  .brand-pill{background:#1e1b4b;color:#fff;font-size:14pt;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:-.6px;line-height:1.1}
  .brand-pill span{color:#e879f9}
  .brand-name{font-weight:700;font-size:9pt;color:#1e1b4b}
  .brand-sub{font-size:7pt;color:#6b7280}
  .company-info{text-align:right;font-size:7.5pt;color:#555;line-height:1.5}

  .doc-title{text-align:center;font-size:12pt;font-weight:700;letter-spacing:.8px;margin:6px 0 2px;color:#1e1b4b}
  .doc-sub{text-align:center;font-size:7.5pt;color:#6b7280;margin-bottom:8px}

  .badge-print{display:inline-block;padding:2px 8px;border-radius:20px;font-size:7.5pt;font-weight:600;background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc}
  .status-row{text-align:center;margin-bottom:8px}

  .section{border:1px solid #e5e7eb;border-radius:5px;margin-bottom:7px;overflow:hidden}
  .section-title{background:#f8fafc;padding:4px 9px;font-weight:600;font-size:8.5pt;border-bottom:1px solid #e5e7eb;color:#1e293b}
  .section-body{padding:6px 9px}
  .row{display:flex;padding:2px 0;border-bottom:1px solid #f1f5f9;gap:6px}
  .row:last-child{border:none}
  .row .lbl{min-width:110px;color:#6b7280;font-size:8pt}
  .row .val{font-weight:500;font-size:8pt}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px}

  .notes-box{border:1px solid #e5e7eb;border-radius:5px;min-height:46px;padding:6px 9px;margin-bottom:7px;font-size:7.8pt;color:#374151;line-height:1.35}
  .notes-label{font-weight:600;font-size:8pt;color:#374151;margin-bottom:3px}

  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
  .sig-box{border:1px solid #d1d5db;border-radius:5px;padding:7px 9px;min-height:70px;display:flex;flex-direction:column;justify-content:space-between}
  .sig-label{font-size:7pt;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.35px}
  .sig-consent{font-size:7pt;color:#374151;line-height:1.35;margin:4px 0}
  .sig-line{border-top:1px solid #9ca3af;margin-top:26px;padding-top:3px;font-size:6.8pt;color:#9ca3af;text-align:center}

  .page1-footer{border-top:1px solid #e5e7eb;margin-top:10px;padding-top:5px;font-size:6.8pt;color:#9ca3af;line-height:1.35;text-align:center}

  /* ── SAYFA 2 – KVKK ── */
  .kvkk-page{width:210mm;position:relative;padding:7mm 9mm}
  .kvkk-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #3730a3;padding-bottom:6px;margin-bottom:10px}
  .kvkk-title{font-size:11pt;font-weight:700;color:#1e1b4b;text-align:center;margin-bottom:3px}
  .kvkk-ref{text-align:center;font-size:7pt;color:#6b7280;margin-bottom:9px}
  .kvkk-section{margin-bottom:8px}
  .kvkk-section h2{font-size:8.3pt;font-weight:700;color:#1e1b4b;margin-bottom:4px;border-left:3px solid #6366f1;padding-left:6px}
  .kvkk-section p,.kvkk-section li{font-size:7.3pt;color:#374151;line-height:1.45;margin-bottom:2px}
  .kvkk-section ul{padding-left:14px}
  .kvkk-table{width:100%;border-collapse:collapse;font-size:7pt;margin-top:5px}
  .kvkk-table th{background:#f1f5f9;padding:4px 6px;text-align:left;font-weight:600;border:1px solid #e2e8f0;color:#1e293b}
  .kvkk-table td{padding:4px 6px;border:1px solid #e2e8f0;color:#374151;vertical-align:top}
  .kvkk-sig{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:11px}
  .kvkk-sig-box{border:1px solid #d1d5db;border-radius:5px;padding:7px 9px;min-height:62px;display:flex;flex-direction:column;justify-content:space-between}
  .kvkk-sig-label{font-size:7pt;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.35px}
  .kvkk-sig-line{border-top:1px solid #9ca3af;margin-top:32px;padding-top:3px;font-size:6.8pt;color:#9ca3af;text-align:center}
  .kvkk-footer{border-top:1px solid #e5e7eb;margin-top:9px;padding-top:5px;font-size:6.8pt;color:#9ca3af;text-align:center;line-height:1.35}
  .highlight-box{background:#eff6ff;border:1px solid #bfdbfe;border-radius:5px;padding:6px 9px;margin:6px 0;font-size:7.2pt;color:#1e40af;line-height:1.4}

  @media print{
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  }
</style>
</head><body>

<div class="page page-break">
  <div class="logo-row">
    <div class="brand-block">
      <div class="brand-pill">mobilfon <span>›</span></div>
      <div>
        <div class="brand-name">Mobilfon Teknoloji A.Ş.</div>
        <div class="brand-sub">Yetkili Teknik Servis Merkezi</div>
      </div>
    </div>
    <div class="company-info">
      Kavacık Mah. Fatih Sultan Mehmet Cd. No:52<br>
      Beykoz / İstanbul<br>
      Tel: 0850 255 30 03 &nbsp;|&nbsp; WhatsApp: 0850 255 30 03<br>
      info@mobilfon.com &nbsp;|&nbsp; www.mobilfon.com.tr
    </div>
  </div>

  <div class="doc-title">TEKNİK SERVİS KABUL FORMU</div>
  <div class="doc-sub">Bu belge cihazınızın servise teslim kaydıdır. Lütfen saklayınız.</div>

  <div class="highlight-box">
    Cihaz durumunu sorgulamak için: <strong>mobilfon-tr.vercel.app</strong>
  </div>

  <div class="status-row">
    <span class="badge-print">Servis No: ${r.servisNo}</span>
    &nbsp;
    <span class="badge-print">Durum: ${statusLabel(r.durum)}</span>
    &nbsp;
    <span class="badge-print">Tarih: ${r.olusturma||'—'}</span>
  </div>

  <div class="two-col">
    <div class="section">
      <div class="section-title">Müşteri Bilgileri</div>
      <div class="section-body">
        <div class="row"><span class="lbl">Ad Soyad</span><span class="val">${r.ad||''} ${r.soyad||''}</span></div>
        <div class="row"><span class="lbl">Telefon</span><span class="val">${r.tel||'—'}</span></div>
        ${r.tc ? `<div class="row"><span class="lbl">TC Kimlik No</span><span class="val">${r.tc}</span></div>` : ''}
        ${r.adres ? `<div class="row"><span class="lbl">Adres</span><span class="val">${r.adres}</span></div>` : ''}
      </div>
    </div>
    <div class="section">
      <div class="section-title">Cihaz Bilgileri</div>
      <div class="section-body">
        <div class="row"><span class="lbl">Marka / Model</span><span class="val">${r.marka||'—'} ${r.model||''}</span></div>
        ${r.imei ? `<div class="row"><span class="lbl">IMEI No</span><span class="val" style="font-family:monospace;font-size:7.6pt">${r.imei}</span></div>` : ''}
        ${r.renk ? `<div class="row"><span class="lbl">Renk</span><span class="val">${r.renk}</span></div>` : ''}
        ${r.aksesuar ? `<div class="row"><span class="lbl">Teslim Edilen Aksesuar</span><span class="val">${r.aksesuar}</span></div>` : ''}
      </div>
    </div>
  </div>

  <div class="section" style="margin-bottom:7px">
    <div class="section-title">Arıza Tanımı</div>
    <div class="section-body">
      <div class="row"><span class="lbl">Arıza / Şikayet</span><span class="val">${r.ariza||'—'}</span></div>
      ${r.notlar ? `<div class="row"><span class="lbl">Müşteri Notu</span><span class="val">${r.notlar}</span></div>` : ''}
    </div>
  </div>

  <div style="margin-bottom:7px">
    <div class="notes-label">Teknik Servis Notları</div>
    <div class="notes-box">${r.teknikNotlar||'&nbsp;'}</div>
  </div>

  ${r.degistirilenparca ? `
  <div class="section" style="margin-bottom:7px">
    <div class="section-title">Değiştirilen Parçalar</div>
    <div class="section-body">
      <div style="font-size:8pt;padding:2px 0">${r.degistirilenparca}</div>
    </div>
  </div>` : ''}

  ${((r.alinanOdeme !== '' && r.alinanOdeme != null) || r.odemeTarihi || r.odemeYontemi) ? `
  <div class="section" style="margin-bottom:7px">
    <div class="section-title">Ödeme Bilgileri</div>
    <div class="section-body">
      ${r.odemeYontemi ? `<div class="row"><span class="lbl">Ödeme Yöntemi</span><span class="val">${r.odemeYontemi}</span></div>` : ''}
      ${(r.alinanOdeme !== '' && r.alinanOdeme != null) ? `<div class="row"><span class="lbl">Alınan Ödeme</span><span class="val">${r.alinanOdeme} ₺</span></div>` : ''}
      ${r.odemeTarihi ? `<div class="row"><span class="lbl">Ödeme Tarihi</span><span class="val">${r.odemeTarihi}</span></div>` : ''}
    </div>
  </div>` : ''}

  <div class="sig-row">
    <div class="sig-box">
      <div class="sig-label">Müşteri Onayı ve İmzası</div>
      <div class="sig-consent">
        Cihazımı yukarıda belirtilen bilgilerle servise teslim ettim. Servis koşullarını,
        arka sayfada yer alan KVKK Aydınlatma Metnini okudum, anladım ve kabul ediyorum.
      </div>
      <div class="sig-line">${r.ad||''} ${r.soyad||''} &nbsp;/&nbsp; Tarih: ……/……/………</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Yetkili Teknisyen Kaşe &amp; İmzası</div>
      <div class="sig-consent">
        Yukarıda belirtilen cihaz tarafımızca teslim alınmış olup müşteriye servise ilişkin
        bilgilendirme yapılmıştır.
      </div>
      <div class="sig-line">Mobilfon Teknoloji A.Ş. &nbsp;/&nbsp; Kaşe &amp; İmza</div>
    </div>
  </div>

  <div class="page1-footer">
    Mobilfon Teknoloji A.Ş. &nbsp;•&nbsp; Kavacık Mah. Fatih Sultan Mehmet Cd. No:52, Beykoz / İstanbul &nbsp;•&nbsp;
    0850 255 30 03 &nbsp;•&nbsp; info@mobilfon.com &nbsp;•&nbsp;
    Teslim tarihinden itibaren 90 gün içinde teslim alınmayan cihazlar için şirketimiz sorumluluk kabul etmemektedir.
  </div>
</div>

<div class="kvkk-page">
  <div class="kvkk-header">
    <div class="brand-block">
      <div class="brand-pill" style="font-size:11.5pt;padding:3px 8px">mobilfon <span>›</span></div>
      <div>
        <div class="brand-name">Mobilfon Teknoloji A.Ş.</div>
        <div class="brand-sub">KVKK Aydınlatma Metni</div>
      </div>
    </div>
    <div class="company-info">
      Servis No: ${r.servisNo}<br>
      Tarih: ${r.olusturma||'—'}
    </div>
  </div>

  <div class="kvkk-title">KİŞİSEL VERİLERİN KORUNMASI KANUNU KAPSAMINDA AYDINLATMA METNİ</div>
  <div class="kvkk-ref">6698 Sayılı Kişisel Verilerin Korunması Kanunu'nun 10. Maddesi Uyarınca Hazırlanmıştır</div>

  <div class="kvkk-section">
    <h2>1. Veri Sorumlusunun Kimliği</h2>
    <p>
      <strong>Unvan:</strong> Mobilfon Teknoloji A.Ş.<br>
      <strong>Adres:</strong> Kavacık Mah. Fatih Sultan Mehmet Cd. No:52, Beykoz / İstanbul<br>
      <strong>Telefon:</strong> 0850 255 30 03 &nbsp;|&nbsp; <strong>WhatsApp:</strong> 0850 255 30 03<br>
      <strong>E-posta:</strong> info@mobilfon.com &nbsp;|&nbsp; <strong>Web:</strong> www.mobilfon.com.tr
    </p>
  </div>

  <div class="kvkk-section">
    <h2>2. İşlenen Kişisel Veriler ve İşlenme Amaçları</h2>
    <table class="kvkk-table">
      <thead>
        <tr>
          <th>Kişisel Veri Kategorisi</th>
          <th>İşlenen Veriler</th>
          <th>İşlenme Amacı</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Kimlik Bilgileri</td>
          <td>Ad, soyad, TC Kimlik No</td>
          <td>Müşteri kimliğinin doğrulanması, servis kaydının oluşturulması, yasal yükümlülüklerin yerine getirilmesi</td>
        </tr>
        <tr>
          <td>İletişim Bilgileri</td>
          <td>Telefon numarası, adres, e-posta</td>
          <td>Servis sürecine ilişkin bilgilendirme, teslim koordinasyonu, müşteri hizmetleri iletişimi</td>
        </tr>
        <tr>
          <td>Cihaz Bilgileri</td>
          <td>Marka, model, IMEI numarası, renk, aksesuar</td>
          <td>Cihazın tanımlanması, güvenli muhafazası, teknik servis işlemlerinin yürütülmesi</td>
        </tr>
        <tr>
          <td>İşlem Güvenliği</td>
          <td>Servis numarası, kabul ve teslim tarihleri</td>
          <td>Servis kaydı takibi, hukuki uyuşmazlıklarda delil oluşturulması, garanti ve yasal saklama yükümlülükleri</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="kvkk-section">
    <h2>3. Kişisel Verilerin Toplanma Yöntemi ve Hukuki Dayanağı</h2>
    <p>
      Kişisel verileriniz; yüz yüze görüşme, yazılı form doldurma ve dijital kayıt sistemi aracılığıyla
      toplanmaktadır. İşlemin hukuki dayanakları aşağıdaki gibidir:
    </p>
    <ul>
      <li>Sözleşmenin kurulması veya ifası için zorunlu olması (KVKK Md. 5/2-c)</li>
      <li>Veri sorumlusunun hukuki yükümlülüğünü yerine getirmesi (KVKK Md. 5/2-ç)</li>
      <li>Veri sorumlusunun meşru menfaatleri (KVKK Md. 5/2-f)</li>
      <li>İlgili kişinin açık rızası — pazarlama ve bilgilendirme amaçlı iletişimler için (KVKK Md. 5/1)</li>
    </ul>
  </div>

  <div class="kvkk-section">
    <h2>4. Kişisel Verilerin Aktarımı</h2>
    <p>
      Kişisel verileriniz; yasal zorunluluk halinde yetkili kamu kurum ve kuruluşlarına, servis faaliyetlerinin
      yürütülmesi amacıyla tedarikçiler ve iş ortaklarına (teknik altyapı, muhasebe, lojistik), yetkili servis
      süreçlerinde cihaz üreticisi veya distribütörüne aktarılabilir. Aktarım KVKK'nın 8. ve 9. maddeleri
      çerçevesinde gerçekleştirilmekte olup yurt dışına aktarım söz konusu olduğunda gerekli güvenceler sağlanmaktadır.
    </p>
  </div>

  <div class="kvkk-section">
    <h2>5. Saklama Süresi</h2>
    <p>
      Kişisel verileriniz, servis ilişkisinin sona ermesinden itibaren Türk Ticaret Kanunu ve ilgili mevzuat
      gereğince <strong>en az 10 yıl</strong> süreyle saklanmakta; bu sürenin sonunda güvenli yöntemlerle imha edilmektedir.
    </p>
  </div>

  <div class="kvkk-section">
    <h2>6. Veri Sahibinin Hakları (KVKK Md. 11)</h2>
    <p>Kişisel veri sahibi olarak aşağıdaki haklara sahipsiniz:</p>
    <ul>
      <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme</li>
      <li>Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme</li>
      <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme</li>
      <li>Yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme</li>
      <li>Eksik veya yanlış işlenmiş kişisel verilerin düzeltilmesini isteme</li>
      <li>KVKK'nın 7. maddesi çerçevesinde kişisel verilerin silinmesini veya yok edilmesini isteme</li>
      <li>İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi sonucu aleyhinize bir sonucun ortaya çıkmasına itiraz etme</li>
      <li>Kişisel verilerin kanuna aykırı işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme</li>
    </ul>
    <div class="highlight-box">
      Haklarınızı kullanmak için; <strong>info@mobilfon.com</strong> adresine e-posta göndererek veya
      <strong>Kavacık Mah. Fatih Sultan Mehmet Cd. No:52, Beykoz / İstanbul</strong> adresine ıslak imzalı dilekçeyle
      ya da kayıtlı elektronik posta (KEP) aracılığıyla şirketimize başvurabilirsiniz.
      Başvurularınız en geç <strong>30 gün</strong> içinde sonuçlandırılacaktır.
    </div>
  </div>

  <div class="kvkk-section">
    <h2>7. Açık Rıza Beyanı</h2>
    <p style="margin-bottom:5px">
      Yukarıda yer alan aydınlatma metnini okudum, anladım ve kişisel verilerimin belirtilen amaçlar
      doğrultusunda işlenmesine <strong>özgür iradem ile</strong> onay veriyorum.
    </p>
    <table class="kvkk-table">
      <thead>
        <tr>
          <th>Onay Konusu</th>
          <th style="text-align:center;width:60px">Onaylıyorum</th>
          <th style="text-align:center;width:80px">Onaylamıyorum</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Servis ve teknik destek hizmetlerinin yürütülmesi amacıyla kişisel verilerimin işlenmesi</td>
          <td style="text-align:center">☐</td>
          <td style="text-align:center">☐</td>
        </tr>
        <tr>
          <td>Kampanya, duyuru ve promosyon amaçlı ticari elektronik ileti (SMS/e-posta) gönderilmesi</td>
          <td style="text-align:center">☐</td>
          <td style="text-align:center">☐</td>
        </tr>
        <tr>
          <td>Hizmet kalitesinin ölçülmesi amacıyla anket ve memnuniyet çalışmaları yapılması</td>
          <td style="text-align:center">☐</td>
          <td style="text-align:center">☐</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="kvkk-sig">
    <div class="kvkk-sig-box">
      <div class="kvkk-sig-label">Veri Sahibi İmzası</div>
      <div class="kvkk-sig-line">${r.ad||''} ${r.soyad||''} &nbsp;/&nbsp; Tarih: ……/……/………</div>
    </div>
    <div class="kvkk-sig-box">
      <div class="kvkk-sig-label">Yetkili / Kaşe &amp; İmza</div>
      <div class="kvkk-sig-line">Mobilfon Teknoloji A.Ş.</div>
    </div>
  </div>

  <div class="kvkk-footer">
    Mobilfon Teknoloji A.Ş. &nbsp;•&nbsp; Kavacık Mah. Fatih Sultan Mehmet Cd. No:52, Beykoz / İstanbul &nbsp;•&nbsp;
    Tel: 0850 255 30 03 &nbsp;•&nbsp; info@mobilfon.com &nbsp;•&nbsp; www.mobilfon.com.tr<br>
    Bu metin 6698 Sayılı KVKK'nın 10. maddesi ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ kapsamında hazırlanmıştır.
  </div>
</div>

<script>window.onload=()=>window.print();<\/script>
</body></html>`);
  win.document.close();
};

// ── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
window.showToast = showToast;

window.doLoginKey = function(e) { if (e.key==='Enter') window.doLogin(); };
