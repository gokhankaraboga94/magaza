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

const EMAILJS_SERVICE_ID = 'service_cvystz7';
const EMAILJS_TEMPLATE_ID = 'template_jj4wrk8';
const EMAILJS_PUBLIC_KEY = 'JXceWP3PZjwHhxDJd';

let emailJsReady = false;
function initEmailJs() {
  if (!isAdminPage) return;
  if (emailJsReady) return;
  const emailjs = window.emailjs;
  if (!emailjs || typeof emailjs.init !== 'function') {
    console.warn('[EmailJS] SDK yüklenmedi veya init fonksiyonu yok.');
    return false;
  }
  try {
    emailjs.init(EMAILJS_PUBLIC_KEY);
    emailJsReady = true;
    console.log('[EmailJS] init ok');
    return true;
  } catch (e) {
    console.error('[EmailJS] init error', e);
    return false;
  }
}

async function sendReadyEmail(r) {
  const initOk = initEmailJs();
  const emailjs = window.emailjs;
  if (!emailJsReady || !emailjs || typeof emailjs.send !== 'function') {
    console.warn('[EmailJS] send çağrılamadı. emailJsReady:', emailJsReady, 'emailjs:', emailjs);
    showToast('E-posta servisi hazır değil.');
    return;
  }
  const toEmail = (r?.email || '').trim();
  if (!toEmail) {
    console.warn('[EmailJS] Kayıtta e-posta yok, gönderim atlandı.', r);
    showToast('Kayıtta e-posta yok.');
    return;
  }
  if (!initOk && !emailJsReady) {
    showToast('E-posta servisi başlatılamadı.');
    return;
  }

  const fullName = ((r.ad || '') + ' ' + (r.soyad || '')).trim() || 'Müşterimiz';
  const servisNo = (r.servisNo || '').toString();

  const queryUrl = `https://mobilfon-tr.vercel.app/?servisNo=${encodeURIComponent(r.servisNo || '')}`;
  const subjectText = `Mobilfon Teknik Servis – Cihazınız Hazır (Servis No: ${servisNo})`;
  const messageText = `Sayın ${fullName}, cihazınız hazırdır. Servis No: ${servisNo}. Lütfen mağazamıza gelip teslim alınız.\n\nCihaz durumunu sorgulamak için: ${queryUrl}`;
  const messageHtml = `Sayın <strong>${fullName}</strong>, cihazınız <strong>hazırdır</strong>.<br>Servis No: <strong>${servisNo}</strong><br><br>Lütfen mağazamıza gelip teslim alınız.<br><br>Cihaz durumunu sorgulamak için: <a href="${queryUrl}">${queryUrl}</a>`;
  const params = {
    to_email: toEmail,
    user_email: toEmail,
    email: toEmail,
    to_name: fullName,
    ad_soyad: fullName,
    customer_name: fullName,
    servis_no: servisNo,
    servisNo: servisNo,
    service_no: servisNo,
    durum: statusLabel('hazir'),
    status: statusLabel('hazir'),
    query_url: queryUrl,
    queryUrl,
    subject: subjectText,
    email_subject: subjectText,
    title: subjectText,
    message: messageText,
    body: messageText,
    message_text: messageText,
    message_html: messageHtml,
    html: messageHtml,
    marka: r.marka || '',
    model: r.model || ''
  };

  try {
    console.log('[EmailJS] sending…', { service: EMAILJS_SERVICE_ID, template: EMAILJS_TEMPLATE_ID, toEmail, params });
    const resp = await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params);
    console.log('[EmailJS] send response', resp);
    showToast('Hazır bildirimi e-posta ile gönderildi ✓');
  } catch (e) {
    console.error('[EmailJS] send error', e);
    const msg = (e && (e.text || e.message)) ? (e.text || e.message) : '';
    showToast('E-posta gönderilemedi.' + (msg ? (' (' + msg + ')') : ''));
  }
}

// ── STATE ──────────────────────────────────────────────────────────────────
let records = {};
let editingId = null;
let currentView = 'list'; // list | form | detail
let hasSyncedPublic = false;
let selectedAgeBucket = null;
let agingTimerStarted = false;

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

function parseTrDateTime(str) {
  const s = (str || '').toString().trim();
  if (!s) return null;
  const parts = s.split(' ');
  const datePart = parts[0] || '';
  const timePart = parts[1] || '';
  const dParts = datePart.split(/[\.\/-]/).map(p => p.trim()).filter(Boolean);
  if (dParts.length < 3) return null;
  const d = parseInt(dParts[0], 10);
  const m = parseInt(dParts[1], 10);
  const y = parseInt(dParts[2], 10);
  if (!y || !m || !d) return null;
  let hh = 0, mm = 0, ss = 0;
  if (timePart) {
    const tParts = timePart.split(':');
    hh = parseInt(tParts[0] || '0', 10) || 0;
    mm = parseInt(tParts[1] || '0', 10) || 0;
    ss = parseInt(tParts[2] || '0', 10) || 0;
  }
  const dt = new Date(y, m - 1, d, hh, mm, ss);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function recordCreatedAtMs(r) {
  const v = r?.createdAtMs;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  const parsed = parseTrDateTime(r?.olusturma);
  return parsed || null;
}

function recordAgeDays(r, nowMs = Date.now()) {
  const createdMs = recordCreatedAtMs(r);
  if (!createdMs) return null;
  const diff = nowMs - createdMs;
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff / 86400000));
}

function ageBucketFromDays(days) {
  if (days == null) return null;
  if (days >= 14) return 'red';
  if (days >= 7) return 'yellow';
  if (days >= 3) return 'green';
  return 'white';
}

function bucketLabel(bucket) {
  const m = {
    white: '0-2 Gün Bekleyenler · Yeni Giriş',
    green: '3-7 Gün Bekleyenler · Normal Süre',
    yellow: '7-14 Gün Bekleyenler · Dikkat Gerekli',
    red: '14+ Gün Bekleyenler · Acil Müdahale'
  };
  return m[bucket] || '';
}

function updateAgingDashboard() {
  const dash = document.getElementById('agingDashboard');
  if (!dash) return;

  const nowMs = Date.now();
  const counts = { white: 0, green: 0, yellow: 0, red: 0 };

  Object.values(records).forEach(r => {
    if (!r) return;
    if ((r.durum || '') === 'teslim') return;
    const days = recordAgeDays(r, nowMs);
    const bucket = ageBucketFromDays(days);
    if (!bucket) return;
    counts[bucket]++;
  });

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  setText('agingCountWhite', counts.white);
  setText('agingCountGreen', counts.green);
  setText('agingCountYellow', counts.yellow);
  setText('agingCountRed', counts.red);

  ['white', 'green', 'yellow', 'red'].forEach(b => {
    const btn = dash.querySelector('.aging-card.aging-' + b);
    if (!btn) return;
    btn.classList.toggle('active', selectedAgeBucket === b);
  });

  const clearBtn = document.getElementById('agingClearBtn');
  if (clearBtn) clearBtn.style.display = selectedAgeBucket ? 'inline-flex' : 'none';

  if (selectedAgeBucket) {
    renderAgingList(selectedAgeBucket);
  }
}

function ensureAgingTimer() {
  if (!isAdminPage) return;
  if (agingTimerStarted) return;
  if (!document.getElementById('agingDashboard')) return;
  agingTimerStarted = true;
  setInterval(() => {
    updateAgingDashboard();
  }, 60 * 1000);
}

function renderAgingList(bucket) {
  const list = document.getElementById('agingList');
  const tbody = document.getElementById('agingTbody');
  const title = document.getElementById('agingListTitle');
  if (!list || !tbody || !title) return;

  const nowMs = Date.now();
  const rows = Object.values(records)
    .filter(r => r && (r.durum || '') !== 'teslim')
    .map(r => ({ r, days: recordAgeDays(r, nowMs) }))
    .filter(x => x.days != null && ageBucketFromDays(x.days) === bucket)
    .sort((a, b) => (b.days - a.days));

  title.textContent = bucketLabel(bucket);
  tbody.innerHTML = rows.map(({ r, days }) => {
    const imei = (r.imei || '—').toString();
    const device = ((r.marka || '—') + ' ' + (r.model || '')).trim();
    const customer = ((r.ad || '') + ' ' + (r.soyad || '')).trim();
    return `
      <tr onclick="showView('detail','${r.firebaseKey}')" style="cursor:pointer">
        <td><strong>${r.servisNo || '—'}</strong></td>
        <td>${customer || '—'}</td>
        <td>${r.tel || '—'}</td>
        <td>${device || '—'}</td>
        <td>${imei}</td>
        <td><strong>${days}</strong></td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:1.25rem;color:#94a3b8">Kayıt bulunamadı</td></tr>`;

  list.style.display = 'block';
}

window.selectAgeBucket = function(bucket) {
  selectedAgeBucket = bucket;
  updateAgingDashboard();
};

window.clearAgeBucket = function() {
  selectedAgeBucket = null;
  const list = document.getElementById('agingList');
  if (list) list.style.display = 'none';
  updateAgingDashboard();
};

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

function imeiLast6(imei) {
  const v = (imei || '').toString().replace(/\s+/g, '');
  if (!v) return '';
  const digits = v.replace(/\D+/g, '');
  const src = digits || v;
  return src.length >= 6 ? src.slice(-6) : src;
}

function toPublicRecord(r) {
  const base = {
    servisNo: r.servisNo || '',
    durum: r.durum || '',
    olusturma: r.olusturma || '',
    guncelleme: r.guncelleme || ''
  };

  if ((r.durum || '') === 'teslim') {
    return {
      ...base,
      imeiLast6: imeiLast6(r.imei)
    };
  }

  return {
    ...base,
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
    if (existing.durum !== updated.durum && updated.durum === 'hazir') {
      await sendReadyEmail(updated);
    }
    showToast('Kayıt güncellendi ✓');
  } else {
    const newRef = push(ref(db, 'servis'));
    const id = await genServisNo();
    const created = { ...data, firebaseKey: newRef.key, servisNo: id, olusturma: ts(), createdAtMs: Date.now() };
    await set(newRef, created);
    await upsertPublic(id, created);
    if (created.durum === 'hazir') {
      await sendReadyEmail(created);
    }
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
  const guncelleme = ts();
  await update(ref(db, 'servis/' + key), { durum: status, guncelleme });
  if (existing.servisNo) {
    await upsertPublic(existing.servisNo, { ...existing, durum: status, guncelleme });
  }
  if (existing.durum !== status && status === 'hazir') {
    await sendReadyEmail({ ...existing, durum: status });
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

    if ((r.durum || '') === 'teslim') {
      const last6 = r.imeiLast6 || imeiLast6(r.imei);
      out.innerHTML = `
        <h3>Servis Durumu</h3>
        <div class="q-row"><span>Durum</span><strong>${statusLabel(r.durum)}</strong></div>
        <div class="q-row"><span>Son Güncelleme</span><strong>${r.guncelleme || r.olusturma || '—'}</strong></div>
        <h3 style="margin-top:1rem">Cihaz</h3>
        <div class="q-row"><span>IMEI (Son 6)</span><strong>${last6 || '—'}</strong></div>
      `;
      out.style.display = 'block';
      return;
    }

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

if (document.getElementById('q_servisNo')) {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('servisNo');
  if (q) {
    const input = document.getElementById('q_servisNo');
    input.value = normalizeServisNo(q);
    window.doPublicQuery();
  }
}

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

  updateAgingDashboard();
  ensureAgingTimer();
}

document.addEventListener('input', e => { if (e.target.id === 'searchBox') renderList(); });
document.addEventListener('change', e => { if (e.target.id === 'filterStatus') renderList(); });

// ── FORM VIEW ─────────────────────────────────────────────────────────────
function populateForm(rec) {
  const fields = ['ad','soyad','tel','email','tc','adres','marka','model','imei','renk','ariza','aksesuar',
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
  const email = get('email').trim();
  if (!email) {
    showToast('E-posta zorunludur.');
    return;
  }
  const data = {
    ad: get('ad'), soyad: get('soyad'), tel: get('tel'), email, tc: get('tc'), adres: get('adres'),
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
  const queryUrl = `https://mobilfon-tr.vercel.app/?servisNo=${encodeURIComponent(r.servisNo || '')}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(queryUrl)}`;
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
  .query-box{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .query-box .q-left{min-width:0}
  .query-box .q-url{word-break:break-all;font-weight:700}
  .qr-img{width:26mm;height:26mm;object-fit:contain;background:#fff;border:1px solid #bfdbfe;border-radius:5px;padding:2mm}

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

  <div class="highlight-box query-box">
    <div class="q-left">
      Cihaz durumunu sorgulamak için QR kodu okutun:<br>
      <span class="q-url">${queryUrl}</span>
    </div>
    <img class="qr-img" src="${qrImg}" alt="Sorgulama QR">
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
