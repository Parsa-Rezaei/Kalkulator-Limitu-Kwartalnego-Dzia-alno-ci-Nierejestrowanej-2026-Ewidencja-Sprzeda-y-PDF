/*
 * Kalkulator i Ewidencja Działalności Nierejestrowanej 2026 – logika aplikacji.
 * Ustawienia zarobkowe (linki partnerskie, BuyCoffee) są w assets/config.js.
 *
 * Bezpieczeństwo:
 *  - Cały tekst od użytkownika trafia do strony przez textContent (bez innerHTML).
 *  - Skrypty ładowane są tylko z tej samej domeny (CSP w index.html) – również przez Trusted Types.
 *  - Dane z localStorage i z importowanych plików są walidowane przed użyciem.
 */
(function () {
  'use strict';

  /* =====================================================================
     STAŁE PRAWNE 2026 – aktualizuj raz w roku
     ===================================================================== */
  const CONFIG = {
    YEAR: 2026,
    MIN_WAGE_GR: 480600,            // minimalne wynagrodzenie 2026: 4806,00 zł (w groszach)
    QUARTER_LIMIT_PERCENT: 225,     // art. 5 ust. 1 Prawa przedsiębiorców (od 1.01.2026 r.)
    WARN_GR: 950000,                // żółte ostrzeżenie powyżej 9500,00 zł w kwartale
    JDG_HINT_RATIO: 0.85,           // od 85% limitu pokazujemy ścieżkę JDG i linki partnerskie
    CASH_REGISTER_LIMIT_GR: 2000000,// 20 000 zł – limit zwolnienia z kasy fiskalnej
    KSEF_MONTHLY_LIMIT_GR: 1000000, // 10 000 zł brutto miesięcznie (1.04–31.12.2026)
    KSEF_FROM_MONTH: 4,
    PIT: { THRESHOLD_ZL: 120000, LOW: 0.12, HIGH: 0.32, REDUCING_ZL: 3600, TAX_AT_THRESHOLD_ZL: 10800 },
    PREF_ZUS_BASE_PERCENT: 30,
    STORAGE_KEY: 'dn2026-ewidencja-v1',
    MAX_IMPORT_BYTES: 5 * 1024 * 1024,
    MAX_TRANSACTIONS: 20000,
    MAX_AMOUNT_GR: 100000000000      // 1 mld zł – górna granica pojedynczej kwoty
  };
  // Jedyne skrypty, które aplikacja może doładować (ta sama domena).
  const PDF_SCRIPTS = ['vendor/pdfmake.min.js', 'vendor/vfs_fonts.js'];
  /* ===================================================================== */

  const YEAR = CONFIG.YEAR;
  const CAP = Math.round(CONFIG.MIN_WAGE_GR * CONFIG.QUARTER_LIMIT_PERCENT / 100);
  const JDG_HINT = Math.round(CAP * CONFIG.JDG_HINT_RATIO);
  const Q_NAMES = ['I', 'II', 'III', 'IV'];
  const Q_RANGES = ['styczeń–marzec', 'kwiecień–czerwiec', 'lipiec–wrzesień', 'październik–grudzień'];
  const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  const MONTHS_LOC = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
  const DOC_LABEL = { rachunek: 'Rachunek', faktura: 'Faktura bez VAT', brak: 'Bez dokumentu' };
  const NBSP = ' ';

  /* ---------- Narzędzia ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Tworzy element DOM. Tekst zawsze przez textContent; style tylko przez CSSOM (zgodne z CSP).
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (/^on/i.test(k)) throw new TypeError('Atrybuty zdarzeń są niedozwolone');
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : String(c));
    }
    return node;
  }
  // replaceChildren() zamienia null na tekst "null" – pomijamy puste elementy.
  const setChildren = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

  const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
  const fmtNum = gr => nf2.format(gr / 100);
  const fmt = gr => fmtNum(gr) + NBSP + 'zł';
  const fmtPct = p => nf1.format(p) + '%';
  const plainNum = gr => fmtNum(gr).replace(/[\s  ]/g, '');

  // "1 234,56" / "1234.56" / "1.234,56" → grosze (liczba całkowita) lub NaN
  function parseMoney(input) {
    let s = String(input == null ? '' : input).trim().replace(/[\s  ]/g, '').replace(/zł$/i, '');
    if (s === '' || s.length > 20) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    const gr = Math.round(parseFloat(s) * 100);
    return gr <= CONFIG.MAX_AMOUNT_GR ? gr : NaN;
  }
  function parseQty(input) {
    const s = String(input == null ? '' : input).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d{1,7}(\.\d{1,3})?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  const optionalMoney = v => (String(v || '').trim() === '' ? 0 : parseMoney(v));

  const pad = n => String(n).padStart(2, '0');
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
  function isValidISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const { y, m, d } = parseISO(s);
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function addDaysISO(s, n) { const { y, m, d } = parseISO(s); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function diffDays(a, b) { const A = parseISO(a), B = parseISO(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000); }
  function endOfMonthISO(y, m) { return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); } // m: 1..n (może przekraczać 12)
  function firstOfMonthISO(y, m) { return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10); }
  function fmtDate(s) { if (!s) return ''; const { y, m, d } = parseISO(s); return `${pad(d)}.${pad(m)}.${y}`; }
  const quarterOf = s => Math.floor((parseISO(s).m - 1) / 3) + 1;
  const daysInYear = y => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
  const plDays = n => (n === 1 ? 'dzień' : 'dni');
  function defaultDate() { const t = todayISO(); return parseISO(t).y === YEAR ? t : `${YEAR}-01-01`; }
  function uid() {
    const bytes = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    return Date.now().toString(36) + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  // Usuwa znaki sterujące i niewidoczne znaki kierunku tekstu (mogą podmieniać wygląd danych).
  const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max);

  /* ---------- Walidacja numerów ---------- */
  function nipValid(raw) {
    const d = String(raw).replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(d)) return false;
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0) % 11;
    return sum !== 10 && sum === Number(d[9]);
  }
  // NIP polski sprawdzamy sumą kontrolną; identyfikatory z prefiksem kraju (np. DE...) przepuszczamy.
  const nipAcceptable = raw => !raw || /^[A-Za-z]{2}[A-Za-z0-9]{2,18}$/.test(String(raw).replace(/[\s-]/g, '')) || nipValid(raw);
  function peselValid(raw) {
    const d = String(raw).replace(/\s/g, '');
    if (!/^\d{11}$/.test(d)) return false;
    const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
    return (10 - (sum % 10)) % 10 === Number(d[10]);
  }
  // Numer konta: 26 cyfr (NRB) lub IBAN. Suma kontrolna mod 97 chroni przed literówką,
  // przez którą klient zapłaciłby na cudze konto.
  function normalizeIban(raw) {
    let s = String(raw || '').replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{26}$/.test(s)) s = 'PL' + s;
    return s;
  }
  function ibanValid(raw) {
    const s = normalizeIban(raw);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    if (s.startsWith('PL') && s.length !== 28) return false;
    let rem = 0;
    for (const ch of s.slice(4) + s.slice(0, 4)) {
      const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
    }
    return rem === 1;
  }
  const formatIban = raw => normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ');
  function safeHttpsUrl(v) {
    try {
      const u = new URL(String(v || ''));
      return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  /* ---------- Ustawienia zarobkowe z assets/config.js (walidowane) ---------- */
  const USER = (function readUserConfig() {
    const raw = window.DN_CONFIG && typeof window.DN_CONFIG === 'object' ? window.DN_CONFIG : {};
    const affiliates = (Array.isArray(raw.AFFILIATES) ? raw.AFFILIATES : []).slice(0, 6)
      .map(a => (a && typeof a === 'object' ? { name: str(a.name, 40), url: safeHttpsUrl(a.url), text: str(a.text, 80) } : null))
      .filter(a => a && a.name && a.url);
    const bc = safeHttpsUrl(raw.BUYCOFFEE_URL);
    const buycoffee = /^https:\/\/(www\.)?buycoffee\.to\/[A-Za-z0-9._-]+\/?$/.test(bc) ? bc : '';
    return Object.freeze({ affiliates: Object.freeze(affiliates.map(Object.freeze)), buycoffee });
  })();

  /* ---------- Kwota słownie ---------- */
  const W_UNITS = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
  const W_TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
  const W_TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
  const W_HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
  function plForm(n, one, few, many) {
    if (n === 1) return one;
    const l1 = n % 10, l2 = n % 100;
    return l1 >= 2 && l1 <= 4 && !(l2 >= 12 && l2 <= 14) ? few : many;
  }
  function words999(n) {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
    const out = [];
    if (h) out.push(W_HUNDREDS[h]);
    if (t === 1) out.push(W_TEENS[u]);
    else { if (t) out.push(W_TENS[t]); if (u) out.push(W_UNITS[u]); }
    return out.join(' ');
  }
  function numberToWordsPL(n) {
    if (n === 0) return 'zero';
    const scales = [null, ['tysiąc', 'tysiące', 'tysięcy'], ['milion', 'miliony', 'milionów'], ['miliard', 'miliardy', 'miliardów']];
    const parts = [];
    for (let i = 0; n > 0 && i < scales.length; i++) {
      const g = n % 1000;
      if (g) {
        if (i === 0) parts.unshift(words999(g));
        else parts.unshift(g === 1 ? scales[i][0] : `${words999(g)} ${plForm(g, ...scales[i])}`);
      }
      n = Math.floor(n / 1000);
    }
    return parts.join(' ');
  }
  function amountInWords(gr) {
    const zl = Math.floor(gr / 100), g = gr % 100;
    return `${numberToWordsPL(zl)} ${plForm(zl, 'złoty', 'złote', 'złotych')} ${pad(g)}/100`;
  }

  /* ---------- Stan i pamięć ---------- */
  const DEFAULT_SETTINGS = {
    seller: { name: '', street: '', city: '', idType: 'NIP', idValue: '', account: '', contact: '' },
    vatBasis: '9', place: '', paymentDays: '14',
    nextNo: { rachunek: 1, faktura: 1 },
    kasaPrev: 'new', etatIncome: '', extraCosts: '', jdgStart: ''
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const emptyState = () => ({ version: 1, transactions: [], settings: clone(DEFAULT_SETTINGS), checklist: {} });
  let state = emptyState();
  let storageOk = true;

  function sanitizeTx(t) {
    if (!t || typeof t !== 'object') return null;
    const date = String(t.date || '');
    if (!isValidISO(date) || parseISO(date).y !== YEAR) return null;
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0 || t.amount > CONFIG.MAX_AMOUNT_GR) return null;
    const paid = t.paid === true;
    const paidDate = paid ? (isValidISO(String(t.paidDate || '')) ? t.paidDate : date) : '';
    return {
      id: typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) ? t.id : uid(),
      date,
      docType: ['rachunek', 'faktura', 'brak'].includes(t.docType) ? t.docType : 'brak',
      docNo: str(t.docNo, 40),
      buyerType: t.buyerType === 'b2b' ? 'b2b' : 'b2c',
      client: str(t.client, 120),
      nip: str(t.nip, 20),
      desc: str(t.desc, 200),
      amount: t.amount,
      paid,
      paidDate,
      cost: Number.isSafeInteger(t.cost) && t.cost >= 0 && t.cost <= CONFIG.MAX_AMOUNT_GR ? t.cost : 0,
      created: Number.isFinite(t.created) ? t.created : Date.now()
    };
  }

  function sanitizeSettings(s) {
    const out = clone(DEFAULT_SETTINGS);
    if (!s || typeof s !== 'object') return out;
    const seller = s.seller && typeof s.seller === 'object' ? s.seller : {};
    for (const k of Object.keys(out.seller)) out.seller[k] = str(seller[k], 160);
    if (!['NIP', 'PESEL'].includes(out.seller.idType)) out.seller.idType = 'NIP';
    out.vatBasis = s.vatBasis === '1' ? '1' : '9';
    out.place = str(s.place, 60);
    out.paymentDays = /^\d{1,3}$/.test(String(s.paymentDays)) ? String(s.paymentDays) : '14';
    const nn = s.nextNo && typeof s.nextNo === 'object' ? s.nextNo : {};
    out.nextNo.rachunek = Number.isSafeInteger(nn.rachunek) && nn.rachunek > 0 && nn.rachunek < 1e6 ? nn.rachunek : 1;
    out.nextNo.faktura = Number.isSafeInteger(nn.faktura) && nn.faktura > 0 && nn.faktura < 1e6 ? nn.faktura : 1;
    out.kasaPrev = ['new', 'under', 'over'].includes(s.kasaPrev) ? s.kasaPrev : 'new';
    out.etatIncome = str(s.etatIncome, 20);
    out.extraCosts = str(s.extraCosts, 20);
    out.jdgStart = isValidISO(s.jdgStart) ? s.jdgStart : '';
    return out;
  }

  function sanitizeState(raw) {
    const txs = Array.isArray(raw && raw.transactions) ? raw.transactions.slice(0, CONFIG.MAX_TRANSACTIONS) : [];
    const seen = new Set();
    const clean = [];
    for (const t of txs) {
      const c = sanitizeTx(t);
      if (!c) continue;
      if (seen.has(c.id)) c.id = uid(); // zdublowane identyfikatory
      seen.add(c.id);
      clean.push(c);
    }
    // Tylko znane pozycje weryfikatora (bez kluczy typu "__proto__").
    const allowed = new Set($$('[data-verify]').map(i => i.dataset.verify));
    const checklist = {};
    if (raw && raw.checklist && typeof raw.checklist === 'object') {
      for (const id of allowed) if (Object.prototype.hasOwnProperty.call(raw.checklist, id)) checklist[id] = raw.checklist[id] === true;
    }
    const total = Array.isArray(raw && raw.transactions) ? raw.transactions.length : 0;
    return { state: { version: 1, transactions: clean, settings: sanitizeSettings(raw && raw.settings), checklist }, dropped: total - clean.length };
  }

  function load() {
    let raw = null;
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY + '-test', '1');
      localStorage.removeItem(CONFIG.STORAGE_KEY + '-test');
      raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    } catch (e) {
      storageOk = false;
    }
    if (raw) {
      try { state = sanitizeState(JSON.parse(raw)).state; }
      catch (e) {
        // Uszkodzony zapis – zachowujemy kopię pod osobnym kluczem i startujemy od zera.
        try { localStorage.setItem(CONFIG.STORAGE_KEY + '-uszkodzone', raw); } catch (e2) { /* brak miejsca */ }
      }
    }
    $('#storage-warning').hidden = storageOk;
  }
  function save() {
    try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { storageOk = false; }
    $('#storage-warning').hidden = storageOk;
  }
  function wipeStorage() {
    try {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
      localStorage.removeItem(CONFIG.STORAGE_KEY + '-uszkodzone');
      sessionStorage.removeItem('dn2026-support-shown');
    } catch (e) { /* pamięć niedostępna */ }
  }

  /* ---------- Obliczenia ---------- */
  function sortTx(txs) {
    return txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created));
  }
  function cumulativeInQuarter(sorted) {
    const cum = [0, 0, 0, 0];
    const map = new Map();
    for (const t of sorted) { const i = quarterOf(t.date) - 1; cum[i] += t.amount; map.set(t.id, cum[i]); }
    return map;
  }
  function computeQuarters(txs) {
    const Q = [1, 2, 3, 4].map(n => ({ n, due: 0, received: 0, unpaid: 0, cost: 0, count: 0, exceedDate: null }));
    for (const t of sortTx(txs)) {
      const q = Q[quarterOf(t.date) - 1];
      q.due += t.amount; q.count++; q.cost += t.cost;
      if (!t.paid) q.unpaid += t.amount;
      if (q.due > CAP && !q.exceedDate) q.exceedDate = t.date;
    }
    for (const t of txs) {
      if (t.paid && t.paidDate && parseISO(t.paidDate).y === YEAR) Q[quarterOf(t.paidDate) - 1].received += t.amount;
    }
    return Q;
  }
  function yearTotals(txs) {
    const r = { due: 0, received: 0, unpaid: 0, receivedOutside: 0, cost: 0, count: txs.length };
    for (const t of txs) {
      r.due += t.amount; r.cost += t.cost;
      if (!t.paid) r.unpaid += t.amount;
      else if (parseISO(t.paidDate).y === YEAR) r.received += t.amount;
      else r.receivedOutside += t.amount;
    }
    return r;
  }
  function computeKasa(txs, prev) {
    const b2c = sortTx(txs.filter(t => t.buyerType === 'b2c'));
    const first = b2c.length ? b2c[0].date : null;
    const yearEnd = `${YEAR}-12-31`;
    let limit = CONFIG.CASH_REGISTER_LIMIT_GR, days = null;
    if (prev === 'new' && first) {
      days = diffDays(first, yearEnd) + 1;
      limit = Math.round(CONFIG.CASH_REGISTER_LIMIT_GR * days / daysInYear(YEAR));
    }
    let sum = 0, exceedDate = null;
    for (const t of b2c) { sum += t.amount; if (sum > limit && !exceedDate) exceedDate = t.date; }
    let kasaFrom = null;
    if (exceedDate) { const { y, m } = parseISO(exceedDate); kasaFrom = firstOfMonthISO(y, m + 3); }
    return { first, days, limit, sum, exceedDate, kasaFrom };
  }
  function computeKsef(txs) {
    const months = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, sum: 0, count: 0 }));
    let lostFrom = null, lostTx = null;
    for (const t of sortTx(txs)) {
      if (t.docType !== 'faktura' || t.buyerType !== 'b2b') continue;
      const m = parseISO(t.date).m;
      months[m - 1].sum += t.amount; months[m - 1].count++;
      if (!lostFrom && m >= CONFIG.KSEF_FROM_MONTH && months[m - 1].sum > CONFIG.KSEF_MONTHLY_LIMIT_GR) { lostFrom = m; lostTx = t; }
    }
    return { months, lostFrom, lostTx };
  }
  function taxScaleGr(baseGr) {
    const P = CONFIG.PIT;
    const base = Math.round(Math.max(0, baseGr) / 100); // podstawa zaokrąglona do pełnych złotych
    const tax = base <= P.THRESHOLD_ZL ? base * P.LOW - P.REDUCING_ZL : P.TAX_AT_THRESHOLD_ZL + (base - P.THRESHOLD_ZL) * P.HIGH;
    return Math.round(Math.max(0, tax)) * 100;          // podatek zaokrąglony do pełnych złotych
  }
  function zusTimeline(startISO) {
    const { y, m, d } = parseISO(startISO);
    const ulgaEnd = endOfMonthISO(y, m + (d === 1 ? 0 : 1) + 5); // 6 pełnych miesięcy kalendarzowych
    const prefStart = addDaysISO(ulgaEnd, 1);
    const p = parseISO(prefStart);
    const prefEnd = endOfMonthISO(p.y, p.m + 23);               // 24 miesiące kalendarzowe
    return { ulgaStart: startISO, ulgaEnd, prefStart, prefEnd, mzpStart: addDaysISO(prefEnd, 1) };
  }

  /* ---------- Powiadomienia ---------- */
  let toastTimer;
  function toast(msg, tone) {
    const box = $('#toast');
    const cls = tone === 'red' ? 'bg-red-700' : tone === 'amber' ? 'bg-amber-600' : 'bg-slate-900';
    box.replaceChildren(el('div', { class: `pointer-events-auto max-w-lg rounded-lg px-4 py-3 text-sm text-white shadow-lg ${cls}`, role: 'status', text: msg }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.replaceChildren(), 6000);
  }
  function alertBox(tone, title, lines, link) {
    const styles = {
      red: 'border-red-300 bg-red-50 text-red-900',
      amber: 'border-amber-300 bg-amber-50 text-amber-900',
      teal: 'border-teal-200 bg-teal-50 text-teal-900',
      violet: 'border-violet-200 bg-violet-50 text-violet-900',
      slate: 'border-slate-200 bg-slate-50 text-slate-700'
    };
    return el('div', { class: `rounded-xl border p-4 ${styles[tone]}`, role: tone === 'red' ? 'alert' : null },
      el('p', { class: 'font-semibold', text: title }),
      lines.map(l => el('p', { class: 'mt-1 text-sm', text: l })),
      link ? el('a', { class: 'mt-2 inline-block text-sm font-semibold underline', href: link.href, target: '_blank', rel: 'noopener noreferrer', text: link.label }) : null);
  }
  function dlRow(label, value, valueClass) {
    return el('div', { class: 'flex items-baseline justify-between gap-3 py-2' },
      el('dt', { class: 'text-slate-600', text: label }),
      el('dd', { class: 'text-right font-semibold tabular-nums ' + (valueClass || 'text-slate-900'), text: value }));
  }
  function progressBar(pct, barClass, label) {
    const width = Math.min(100, Math.max(0, pct));
    return el('div', { class: 'h-2.5 w-full overflow-hidden rounded-full bg-slate-100', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': width.toFixed(0) },
      el('div', { class: `h-full rounded-full ${barClass}`, style: { width: width.toFixed(2) + '%' } }));
  }

  /* ---------- Render: kwartały ---------- */
  function currentQuarter() { const t = todayISO(); return parseISO(t).y === YEAR ? quarterOf(t) : 0; }

  function renderQuarters(Q) {
    const wrap = $('#quarter-cards');
    wrap.replaceChildren();
    const cq = currentQuarter();
    const warnPos = (CONFIG.WARN_GR / CAP * 100).toFixed(2) + '%';
    Q.forEach((q, i) => {
      const pct = q.due / CAP * 100;
      const level = q.due > CAP ? 'over' : q.due > CONFIG.WARN_GR ? 'warn' : 'ok';
      const bar = level === 'over' ? 'bg-red-600' : level === 'warn' ? 'bg-amber-500' : 'bg-teal-600';
      const badge = level === 'over' ? ['Przekroczony', 'bg-red-100 text-red-800'] : level === 'warn' ? ['Ostrzeżenie', 'bg-amber-100 text-amber-800'] : ['W limicie', 'bg-teal-50 text-teal-800'];
      const meter = progressBar(pct, bar, `Wykorzystanie limitu w ${Q_NAMES[i]} kwartale`);
      meter.classList.add('relative', 'mt-3');
      meter.append(el('div', { class: 'absolute inset-y-0 w-0.5 bg-slate-400/70', style: { left: warnPos }, title: `Próg ostrzegawczy ${fmt(CONFIG.WARN_GR)}` }));
      wrap.append(el('article', { class: 'card' + (cq === i + 1 ? ' ring-2 ring-teal-600/40' : '') },
        el('div', { class: 'flex items-start justify-between gap-2' },
          el('div', null,
            el('h3', { class: 'h3', text: `${Q_NAMES[i]} kwartał` }),
            el('p', { class: 'text-xs text-slate-500', text: Q_RANGES[i] + (cq === i + 1 ? ' · bieżący' : '') })),
          el('span', { class: 'badge shrink-0 whitespace-nowrap ' + badge[1], text: badge[0] })),
        el('p', { class: 'mt-3 text-2xl font-bold tabular-nums text-slate-900', text: fmt(q.due) }),
        el('p', { class: 'text-xs text-slate-500', text: `z ${fmt(CAP)} · ${fmtPct(pct)}` }),
        meter,
        el('dl', { class: 'mt-3 space-y-1 text-xs' },
          miniRow(level === 'over' ? 'Ponad limit' : 'Pozostało do limitu', level === 'over' ? fmt(q.due - CAP) : fmt(CAP - q.due), level === 'over' ? 'text-red-700' : 'text-slate-900'),
          miniRow('W tym nieopłacone', fmt(q.unpaid)),
          miniRow('Otrzymano w kwartale', fmt(q.received)),
          miniRow('Liczba sprzedaży', String(q.count)))));
    });
  }
  function miniRow(label, value, cls) {
    return el('div', { class: 'flex justify-between gap-2' }, el('dt', { class: 'text-slate-500', text: label }), el('dd', { class: 'font-semibold tabular-nums ' + (cls || 'text-slate-700'), text: value }));
  }

  function renderAlerts(Q) {
    const box = $('#alerts');
    box.replaceChildren();
    const today = todayISO();
    Q.forEach((q, i) => {
      if (q.due > CAP) {
        const deadline = addDaysISO(q.exceedDate, 7);
        const left = diffDays(today, deadline);
        const when = left > 0 ? `zostało ${left} ${plDays(left)}` : left === 0 ? 'termin upływa dziś' : `termin minął ${-left} ${plDays(-left)} temu`;
        box.append(alertBox('red', `${Q_NAMES[i]} kwartał: przekroczono limit ${fmt(CAP)}`, [
          `Przychód należny: ${fmt(q.due)} – o ${fmt(q.due - CAP)} ponad limit. Limit przekroczyła sprzedaż z dnia ${fmtDate(q.exceedDate)} r.`,
          `Z tym dniem działalność stała się działalnością gospodarczą. Wniosek o wpis do CEIDG złóż w ciągu 7 dni – najpóźniej ${fmtDate(deadline)} r. (${when}).`
        ], { href: 'https://www.biznes.gov.pl/', label: 'Wniosek CEIDG online – biznes.gov.pl' }));
      } else if (q.due > CONFIG.WARN_GR) {
        box.append(alertBox('amber', `${Q_NAMES[i]} kwartał: zbliżasz się do limitu`, [
          `Przychód należny ${fmt(q.due)} przekracza próg ostrzegawczy ${fmt(CONFIG.WARN_GR)}. Do limitu zostało ${fmt(CAP - q.due)}. Każdy nowy rachunek lub faktura – także nieopłacone – wlicza się do limitu.`
        ]));
      }
    });
  }

  function renderJdg(Q) {
    const card = $('#jdg-card');
    const show = Q.some(q => q.due >= JDG_HINT);
    card.hidden = !show;
    if (!show) return;
    const firstExceed = Q.map(q => q.exceedDate).filter(Boolean).sort()[0];
    const input = $('#jdg-start');
    const start = state.settings.jdgStart || firstExceed || addDaysISO(todayISO(), 1);
    if (input.value !== start) input.value = start;
    const z = zusTimeline(start);
    const prefBase = Math.round(CONFIG.MIN_WAGE_GR * CONFIG.PREF_ZUS_BASE_PERCENT / 100);
    const steps = [
      ['1. Ulga na start', `${fmtDate(z.ulgaStart)} – ${fmtDate(z.ulgaEnd)}`, '0 zł składek na ubezpieczenia społeczne przez 6 pełnych miesięcy kalendarzowych. Składka zdrowotna płatna.'],
      ['2. Preferencyjny ZUS', `${fmtDate(z.prefStart)} – ${fmtDate(z.prefEnd)}`, `24 miesiące składek od podstawy 30% minimalnego wynagrodzenia (w 2026 r. ${fmt(prefBase)}).`],
      ['3. Mały ZUS Plus', `od ${fmtDate(z.mzpStart)}`, 'Do 36 miesięcy w ciągu 60 miesięcy – składki zależne od dochodu, po spełnieniu warunków.']
    ];
    $('#jdg-timeline').replaceChildren(...steps.map(s => el('li', { class: 'rounded-lg border border-indigo-200 bg-white p-3' },
      el('p', { class: 'text-sm font-semibold text-indigo-950', text: s[0] }),
      el('p', { class: 'text-sm font-semibold tabular-nums text-indigo-700', text: s[1] }),
      el('p', { class: 'mt-1 text-xs text-slate-600', text: s[2] }))));
    renderAffiliates();
  }

  function renderAffiliates() {
    const box = $('#affiliate-box');
    const list = USER.affiliates;
    $('#affiliate-disclosure').hidden = !list.length;
    if (!list.length) { box.replaceChildren(); return; }
    box.replaceChildren(el('div', { class: 'rounded-lg border border-indigo-200 bg-white p-4' },
      el('p', { class: 'font-semibold text-slate-900', text: `Przekraczasz ${fmt(CAP)}? Załóż JDG i przejdź na księgowość online` }),
      el('div', { class: 'mt-3 flex flex-wrap gap-2' }, list.map(a => el('a', { class: 'btn-primary', href: a.url, target: '_blank', rel: 'sponsored noopener' }, a.text ? `${a.name} – ${a.text}` : a.name))),
      el('p', { class: 'mt-2 text-xs text-slate-500', text: 'Link partnerski. Warunki i ceny sprawdź u dostawcy.' })));
  }

  function renderYearTotals() {
    const r = yearTotals(state.transactions);
    setChildren($('#year-totals'),
      dlRow('Przychód należny (do limitu)', fmt(r.due)),
      dlRow('Przychód otrzymany w 2026 (do PIT)', fmt(r.received)),
      dlRow('Należności nieopłacone', fmt(r.unpaid), r.unpaid ? 'text-amber-700' : 'text-slate-900'),
      r.receivedOutside ? dlRow('Zapłacone po 2026 r. (PIT za rok wpływu)', fmt(r.receivedOutside)) : null,
      dlRow('Koszty udokumentowane', fmt(r.cost)),
      dlRow('Liczba sprzedaży', String(r.count)),
      dlRow('Maks. przychód w roku (4 × limit)', fmt(CAP * 4), 'text-slate-500'));
  }

  let chart = null;
  function renderChart(Q) {
    if (typeof window.Chart === 'undefined') { $('#chart-fallback').hidden = false; return; }
    const data = {
      labels: Q_NAMES.map(n => `${n} kw.`),
      datasets: [
        { type: 'bar', label: 'Przychód należny', data: Q.map(q => q.due / 100), backgroundColor: Q.map(q => (q.due > CAP ? '#dc2626' : q.due > CONFIG.WARN_GR ? '#f59e0b' : '#0d9488')), borderRadius: 6, order: 2 },
        { type: 'bar', label: 'Przychód otrzymany', data: Q.map(q => q.received / 100), backgroundColor: '#94a3b8', borderRadius: 6, order: 3 },
        { type: 'line', label: `Limit ${fmt(CAP)}`, data: Q.map(() => CAP / 100), borderColor: '#b91c1c', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, order: 1 }
      ]
    };
    if (chart) { chart.data = data; chart.update(); return; }
    chart = new window.Chart($('#q-chart'), {
      type: 'bar',
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(Math.round(c.parsed.y * 100))}` } }
        },
        scales: { y: { beginAtZero: true, suggestedMax: CAP / 100 * 1.15, ticks: { callback: v => nf0.format(v) + ' zł' } } }
      }
    });
  }

  /* ---------- Render: tabela ---------- */
  function renderTable() {
    const tbody = $('#tx-body');
    tbody.replaceChildren();
    const filter = $('#tx-filter').value;
    const sorted = sortTx(state.transactions);
    const cum = cumulativeInQuarter(sorted);
    const rows = sorted.map((t, i) => [t, i + 1]).filter(([t]) =>
      filter === 'all' ? true : filter === 'unpaid' ? !t.paid : quarterOf(t.date) === Number(filter));
    $('#tx-count').textContent = `${state.transactions.length} pozycji w ewidencji` + (filter !== 'all' ? ` · widoczne: ${rows.length}` : '');
    if (!rows.length) {
      tbody.append(el('tr', null, el('td', { colspan: '10', class: 'px-3 py-8 text-center text-sm text-slate-500',
        text: state.transactions.length ? 'Brak pozycji dla wybranego filtra.' : 'Brak sprzedaży. Dodaj pierwszą pozycję powyżej lub wczytaj przykładowe dane.' })));
      return;
    }
    for (const [t, lp] of rows) {
      const c = cum.get(t.id);
      tbody.append(el('tr', { class: 'hover:bg-slate-50' },
        el('td', { class: 'td text-slate-500', text: String(lp) }),
        el('td', { class: 'td tabular-nums', text: fmtDate(t.date) }),
        el('td', { class: 'td' }, el('span', { class: 'block', text: DOC_LABEL[t.docType] }), t.docNo ? el('span', { class: 'block text-xs text-slate-500', text: t.docNo }) : null),
        el('td', { class: 'td min-w-[8rem] max-w-[12rem] whitespace-normal' },
          el('span', { class: 'block', text: t.client || (t.buyerType === 'b2b' ? 'Firma' : 'Osoba prywatna') }),
          el('span', { class: 'block text-xs text-slate-500', text: (t.buyerType === 'b2b' ? 'B2B' : 'B2C') + (t.nip ? ` · NIP ${t.nip}` : '') })),
        el('td', { class: 'td min-w-[10rem] max-w-[16rem] whitespace-normal text-slate-600', text: t.desc }),
        el('td', { class: 'td text-right font-semibold tabular-nums', text: fmt(t.amount) }),
        el('td', { class: 'td text-right tabular-nums ' + (c > CAP ? 'font-semibold text-red-700' : c > CONFIG.WARN_GR ? 'text-amber-700' : 'text-slate-600'), text: fmt(c) }),
        el('td', { class: 'td' }, t.paid
          ? [el('span', { class: 'badge bg-teal-50 text-teal-800', text: 'Opłacone' }), el('span', { class: 'block text-xs tabular-nums text-slate-500', text: fmtDate(t.paidDate) })]
          : el('span', { class: 'badge bg-amber-100 text-amber-800', text: 'Należne' })),
        el('td', { class: 'td text-right tabular-nums text-slate-600', text: t.cost ? fmt(t.cost) : '—' }),
        el('td', { class: 'td' }, el('div', { class: 'flex w-36 flex-wrap gap-1' },
          el('button', { type: 'button', class: 'btn-secondary btn-sm', 'data-action': 'edit', 'data-id': t.id, text: 'Edytuj' }),
          t.paid ? null : el('button', { type: 'button', class: 'btn-secondary btn-sm', 'data-action': 'pay', 'data-id': t.id, title: 'Oznacz jako opłacone dziś', text: 'Opłać' }),
          el('button', { type: 'button', class: 'btn-secondary btn-sm', 'data-action': 'invoice', 'data-id': t.id, title: 'Wystaw rachunek lub fakturę PDF', text: 'PDF' }),
          el('button', { type: 'button', class: 'btn-danger btn-sm', 'data-action': 'delete', 'data-id': t.id, 'aria-label': `Usuń pozycję ${lp}`, text: 'Usuń' })))));
    }
  }

  /* ---------- Render: weryfikator ---------- */
  function renderVerifier() {
    const checked = $$('[data-verify]').filter(i => i.checked);
    const kasa = checked.map(i => i.dataset.kasa).filter(Boolean);
    const vat = checked.map(i => i.dataset.vat).filter(Boolean);
    const box = $('#verify-result');
    box.replaceChildren();
    if (!checked.length) {
      box.append(alertBox('slate', 'Nic nie zaznaczono', ['Zaznacz rodzaje sprzedaży po lewej stronie, aby sprawdzić obowiązek kasy fiskalnej i VAT od pierwszej złotówki.']));
      return;
    }
    if (kasa.length) {
      box.append(alertBox('red', 'Kasa fiskalna od pierwszej sprzedaży osobie prywatnej', [
        ...kasa.map(k => '• ' + k),
        'Obowiązek dotyczy sprzedaży na rzecz osób prywatnych i rolników ryczałtowych (B2C). Sprzedaż wyłącznie firmom nie wymaga kasy. Do kasy online potrzebny jest NIP.'
      ]));
    }
    if (vat.length) {
      box.append(alertBox('violet', 'Brak zwolnienia z VAT – VAT od pierwszej złotówki', [
        ...vat.map(v => '• ' + v),
        'Przed pierwszą sprzedażą zarejestruj się jako czynny podatnik VAT (VAT-R). Działalność nierejestrowana nadal jest możliwa, ale obowiązki w VAT (faktury, JPK) są takie same jak w firmie.'
      ]));
    }
    if (!kasa.length) box.append(alertBox('teal', 'Kasa fiskalna – zasady ogólne', ['Dla zaznaczonych pozycji kasa nie jest wymagana od pierwszej złotówki. Obowiązuje limit 20 000 zł obrotu B2C w roku (sekcja „Limity kasy i KSeF”).']));
    if (!vat.length) box.append(alertBox('teal', 'VAT – zwolnienie podmiotowe', ['Dla zaznaczonych pozycji możesz korzystać ze zwolnienia z VAT do 240 000 zł sprzedaży w 2026 r.']));
  }

  /* ---------- Render: kasa i KSeF ---------- */
  function renderKasa() {
    const prev = state.settings.kasaPrev;
    $$('input[name="kasa-prev"]').forEach(r => { r.checked = r.value === prev; });
    const k = computeKasa(state.transactions, prev);
    const box = $('#kasa-result');
    box.replaceChildren();
    if (prev === 'over') {
      box.append(alertBox('red', 'Kasa fiskalna wymagana', ['Obrót B2C w 2025 r. przekroczył 20 000 zł, więc w 2026 r. sprzedaż dla osób prywatnych ewidencjonujesz na kasie.']));
      return;
    }
    const pct = k.limit ? k.sum / k.limit * 100 : 0;
    const bar = k.exceedDate ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-teal-600';
    const dl = el('dl', { class: 'divide-y divide-slate-100' },
      dlRow('Sprzedaż B2C w 2026 r.', fmt(k.sum)),
      dlRow('Twój limit w 2026 r.', fmt(k.limit)),
      k.days != null ? dlRow('Sposób liczenia', `20 000 zł × ${k.days} dni / ${daysInYear(YEAR)}`, 'text-slate-600') : null,
      k.first ? dlRow('Pierwsza sprzedaż B2C', fmtDate(k.first), 'text-slate-600') : null,
      dlRow(k.exceedDate ? 'Ponad limit' : 'Pozostało', fmt(Math.abs(k.limit - k.sum)), k.exceedDate ? 'text-red-700' : 'text-slate-900'));
    box.append(progressBar(pct, bar, 'Wykorzystanie limitu kasy fiskalnej'), dl);
    if (k.exceedDate) {
      box.append(alertBox('red', 'Limit kasy fiskalnej przekroczony', [
        `Limit przekroczyła sprzedaż z dnia ${fmtDate(k.exceedDate)} r. Zwolnienie traci moc po upływie dwóch miesięcy od końca miesiąca, w którym przekroczono limit – kasę trzeba stosować najpóźniej od ${fmtDate(k.kasaFrom)} r.`
      ]));
    } else if (pct >= 80) {
      box.append(alertBox('amber', 'Zbliżasz się do limitu kasy fiskalnej', [`Wykorzystano ${fmtPct(pct)} limitu.`]));
    }
    const needs = $$('[data-verify]').filter(i => i.checked && i.dataset.kasa);
    if (needs.length) box.append(alertBox('red', 'Uwaga: weryfikator wskazuje kasę od 1. zł', ['W weryfikatorze zaznaczono sprzedaż wymagającą kasy od pierwszej sprzedaży osobie prywatnej – limit 20 000 zł jej nie dotyczy.']));
  }

  function renderKsef() {
    const k = computeKsef(state.transactions);
    const box = $('#ksef-result');
    const rows = k.months.filter(m => m.m >= CONFIG.KSEF_FROM_MONTH).map(m => {
      const over = m.sum > CONFIG.KSEF_MONTHLY_LIMIT_GR;
      const lost = k.lostFrom && m.m >= k.lostFrom;
      return el('tr', null,
        el('td', { class: 'py-1.5 pr-3 capitalize', text: MONTHS[m.m - 1] }),
        el('td', { class: 'py-1.5 pr-3 text-right tabular-nums', text: fmt(m.sum) }),
        el('td', { class: 'py-1.5' }, over
          ? el('span', { class: 'badge bg-red-100 text-red-800', text: 'Ponad 10 000 zł' })
          : lost ? el('span', { class: 'badge bg-red-50 text-red-700', text: 'KSeF obowiązkowy' })
            : el('span', { class: 'badge bg-teal-50 text-teal-800', text: 'Poza KSeF dozwolone' })));
    });
    const summary = k.lostFrom
      ? alertBox('red', 'Limit KSeF przekroczony', [`W ${MONTHS_LOC[k.lostFrom - 1]} wartość faktur B2B przekroczyła 10 000 zł (faktura z dnia ${fmtDate(k.lostTx.date)} r.${k.lostTx.docNo ? ', nr ' + k.lostTx.docNo : ''}). Od tej faktury do końca 2026 r. faktury dla firm wystawiasz w KSeF.`])
      : alertBox('teal', 'Limit KSeF nieprzekroczony', ['W żadnym miesiącu od kwietnia 2026 r. faktury B2B nie przekroczyły 10 000 zł brutto.']);
    summary.classList.add('mt-3');
    box.replaceChildren(
      el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
        el('thead', null, el('tr', { class: 'text-left text-xs text-slate-500' },
          el('th', { class: 'py-1 pr-3 font-medium', scope: 'col', text: 'Miesiąc' }),
          el('th', { class: 'py-1 pr-3 text-right font-medium', scope: 'col', text: 'Faktury B2B (brutto)' }),
          el('th', { class: 'py-1 font-medium', scope: 'col', text: 'Status' }))),
        el('tbody', { class: 'divide-y divide-slate-100' }, rows))),
      summary);
  }

  /* ---------- Render: PIT ---------- */
  function renderPit() {
    const etat = optionalMoney(state.settings.etatIncome);
    const extra = optionalMoney(state.settings.extraCosts);
    const err = [];
    if (Number.isNaN(etat)) err.push('Nieprawidłowa kwota dochodu z etatu.');
    if (Number.isNaN(extra)) err.push('Nieprawidłowa kwota dodatkowych kosztów.');
    $('#pit-error').textContent = err.join(' ');
    const etatGr = Number.isNaN(etat) ? 0 : etat;
    const extraGr = Number.isNaN(extra) ? 0 : extra;
    const r = yearTotals(state.transactions);
    const costs = r.cost + extraGr;
    const dn = r.received - costs;
    const base = etatGr + Math.max(0, dn);
    const taxAll = taxScaleGr(base);
    const taxEtat = taxScaleGr(etatGr);
    const extraTax = taxAll - taxEtat;
    const rate = dn > 0 ? extraTax / dn * 100 : 0;
    setChildren($('#pit-result'),
      dlRow('Przychód otrzymany w 2026 r.', fmt(r.received)),
      dlRow('Koszty udokumentowane', fmt(costs)),
      dlRow(dn >= 0 ? 'Dochód z działalności nierejestrowanej' : 'Strata z działalności nierejestrowanej', fmt(Math.abs(dn)), dn >= 0 ? 'text-slate-900' : 'text-amber-700'),
      dlRow('Dochód z etatu/zleceń (po składkach)', fmt(etatGr)),
      dlRow('Podstawa opodatkowania (zaokr. do zł)', fmt(Math.round(base / 100) * 100)),
      dlRow('Podatek łączny wg skali', fmt(taxAll)),
      dlRow('Podatek od samego etatu', fmt(taxEtat), 'text-slate-600'),
      dlRow('Szacunkowy podatek do dopłaty z DN', fmt(extraTax), extraTax > 0 ? 'text-red-700' : 'text-teal-700'),
      dn > 0 ? dlRow('Efektywna stawka od dochodu z DN', fmtPct(rate), 'text-slate-600') : null,
      r.unpaid ? dlRow('Nieopłacone – do PIT w roku wpływu', fmt(r.unpaid), 'text-amber-700') : null,
      dlRow('Termin złożenia PIT-36', '30.04.2027 r.', 'text-slate-600'));
  }

  /* ---------- Dane sprzedawcy: walidacja ---------- */
  function sellerProblems() {
    const s = state.settings.seller;
    const out = { account: '', id: '' };
    if (s.account && !ibanValid(s.account)) out.account = 'Nieprawidłowy numer konta (błędna suma kontrolna lub długość). Sprawdź każdą cyfrę – pomyłka oznacza wpłatę na cudze konto.';
    if (s.idValue) {
      if (s.idType === 'NIP' && !nipValid(s.idValue)) out.id = 'Nieprawidłowy NIP (sprawdź cyfry).';
      if (s.idType === 'PESEL' && !peselValid(s.idValue)) out.id = 'Nieprawidłowy PESEL (sprawdź cyfry).';
    }
    return out;
  }
  function renderSellerErrors() {
    const p = sellerProblems();
    $('#s-account-error').textContent = p.account;
    $('#s-id-error').textContent = p.id;
    $('#s-account').setAttribute('aria-invalid', p.account ? 'true' : 'false');
    $('#s-id-value').setAttribute('aria-invalid', p.id ? 'true' : 'false');
  }

  function renderAll() {
    const Q = computeQuarters(state.transactions);
    renderQuarters(Q);
    renderAlerts(Q);
    renderJdg(Q);
    renderYearTotals();
    renderChart(Q);
    renderTable();
    renderKasa();
    renderKsef();
    renderPit();
    renderSellerErrors();
  }

  /* ---------- Formularz sprzedaży ---------- */
  let editingId = null;
  let linkedTxId = null;
  // Numery sugerowane automatycznie odświeżamy tylko, jeśli użytkownik ich nie zmienił.
  let autoTxNo = '', autoInvNo = '';

  function resetTxForm() {
    editingId = null;
    $('#tx-form').reset();
    $('#tx-date').value = defaultDate();
    $('#tx-paid-date').value = $('#tx-date').value;
    $('#tx-error').textContent = '';
    $('#tx-form-title').textContent = 'Dodaj sprzedaż do ewidencji';
    $('#tx-submit').textContent = 'Dodaj do ewidencji';
    $('#tx-cancel').hidden = true;
    setAutoTxNo();
    syncPaidDate();
  }
  function setAutoTxNo() {
    const type = $('#tx-doc-type').value;
    autoTxNo = type === 'brak' ? '' : suggestedNo(type);
    $('#tx-doc-no').value = autoTxNo;
  }
  function setAutoInvNo() {
    autoInvNo = suggestedNo($('#inv-kind').value);
    $('#inv-no').value = autoInvNo;
  }
  function refreshAutoNumbers() {
    if (!editingId && $('#tx-doc-no').value === autoTxNo) setAutoTxNo();
    if (!linkedTxId && $('#inv-no').value === autoInvNo) setAutoInvNo();
  }
  function syncPaidDate() {
    const paid = $('#tx-status').value === 'paid';
    const pd = $('#tx-paid-date');
    pd.disabled = !paid;
    if (paid && !pd.value) pd.value = $('#tx-date').value;
  }
  function readTxForm() {
    const errors = [];
    const date = $('#tx-date').value;
    if (!isValidISO(date) || parseISO(date).y !== YEAR) errors.push(`Podaj datę sprzedaży z roku ${YEAR}.`);
    const amount = parseMoney($('#tx-amount').value);
    if (!(amount > 0)) errors.push('Podaj kwotę brutto większą od zera, np. 350,00.');
    const cost = optionalMoney($('#tx-cost').value);
    if (Number.isNaN(cost)) errors.push('Nieprawidłowa kwota kosztu.');
    const paid = $('#tx-status').value === 'paid';
    const paidDate = paid ? $('#tx-paid-date').value : '';
    if (paid && !isValidISO(paidDate)) errors.push('Podaj datę zapłaty.');
    const nip = $('#tx-nip').value.trim();
    if (!nipAcceptable(nip)) errors.push('Nieprawidłowy NIP (sprawdź cyfry).');
    if (!editingId && state.transactions.length >= CONFIG.MAX_TRANSACTIONS) errors.push('Osiągnięto maksymalną liczbę pozycji.');
    return {
      errors,
      tx: {
        date, amount, cost: Number.isNaN(cost) ? 0 : cost, paid, paidDate,
        docType: $('#tx-doc-type').value, docNo: str($('#tx-doc-no').value, 40),
        buyerType: $('#tx-buyer-type').value, nip: str(nip, 20),
        client: str($('#tx-client').value, 120), desc: str($('#tx-desc').value, 200)
      }
    };
  }
  function fillTxForm(t) {
    $('#tx-date').value = t.date;
    $('#tx-amount').value = plainNum(t.amount);
    $('#tx-status').value = t.paid ? 'paid' : 'due';
    $('#tx-paid-date').value = t.paidDate || t.date;
    $('#tx-doc-type').value = t.docType;
    $('#tx-doc-no').value = t.docNo;
    $('#tx-buyer-type').value = t.buyerType;
    $('#tx-nip').value = t.nip;
    $('#tx-client').value = t.client;
    $('#tx-desc').value = t.desc;
    $('#tx-cost').value = t.cost ? plainNum(t.cost) : '';
    syncPaidDate();
  }

  // Porównuje stan przed i po zmianie i pokazuje komunikat o przekroczonych progach.
  function notifyThresholds(before, after, tx) {
    const i = quarterOf(tx.date) - 1;
    const b = before.q[i].due, a = after.q[i].due;
    if (b <= CAP && a > CAP) toast(`${Q_NAMES[i]} kwartał: przekroczono limit ${fmt(CAP)}. Masz 7 dni na wniosek CEIDG – szczegóły w alercie.`, 'red');
    else if (b <= CONFIG.WARN_GR && a > CONFIG.WARN_GR) toast(`${Q_NAMES[i]} kwartał: przekroczono próg ostrzegawczy ${fmt(CONFIG.WARN_GR)}.`, 'amber');
    else if (!before.ksef.lostFrom && after.ksef.lostFrom) toast('Limit KSeF 10 000 zł w miesiącu przekroczony – kolejne faktury B2B wystawiaj w KSeF.', 'red');
    else if (!before.kasa.exceedDate && after.kasa.exceedDate) toast('Przekroczono limit zwolnienia z kasy fiskalnej – sprawdź termin w sekcji „Limity kasy i KSeF”.', 'red');
  }
  function snapshot() {
    return { q: computeQuarters(state.transactions), ksef: computeKsef(state.transactions), kasa: computeKasa(state.transactions, state.settings.kasaPrev) };
  }
  function upsertTx(data, id) {
    const before = snapshot();
    let tx;
    if (id) {
      const idx = state.transactions.findIndex(t => t.id === id);
      if (idx < 0) return null;
      tx = sanitizeTx({ ...state.transactions[idx], ...data, id });
      if (!tx) return null;
      state.transactions[idx] = tx;
    } else {
      tx = sanitizeTx({ ...data, id: uid(), created: Date.now() });
      if (!tx) return null;
      state.transactions.push(tx);
    }
    if (tx.docType !== 'brak') bumpCounter(tx.docType, tx.docNo);
    save();
    refreshAutoNumbers();
    renderAll();
    notifyThresholds(before, snapshot(), tx);
    return tx;
  }

  function onTxSubmit(e) {
    e.preventDefault();
    const { errors, tx } = readTxForm();
    if (errors.length) { $('#tx-error').textContent = errors.join(' '); return; }
    const wasEditing = !!editingId;
    upsertTx(tx, editingId);
    resetTxForm();
    if (wasEditing) toast('Zapisano zmiany.');
  }

  function onTableClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const t = state.transactions.find(x => x.id === btn.dataset.id);
    if (!t) return;
    const action = btn.dataset.action;
    if (action === 'edit') {
      editingId = t.id;
      fillTxForm(t);
      $('#tx-form-title').textContent = 'Edytuj sprzedaż';
      $('#tx-submit').textContent = 'Zapisz zmiany';
      $('#tx-cancel').hidden = false;
      $('#tx-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#tx-amount').focus({ preventScroll: true });
    } else if (action === 'pay') {
      upsertTx({ paid: true, paidDate: todayISO() }, t.id);
      toast(`Oznaczono jako opłacone ${fmtDate(todayISO())}. Datę zapłaty zmienisz w edycji.`);
    } else if (action === 'delete') {
      if (confirm(`Usunąć pozycję z ${fmtDate(t.date)} na kwotę ${fmt(t.amount)}?`)) {
        state.transactions = state.transactions.filter(x => x.id !== t.id);
        if (editingId === t.id) resetTxForm();
        if (linkedTxId === t.id) resetInvoiceForm();
        save(); renderAll();
      }
    } else if (action === 'invoice') {
      prefillInvoiceFromTx(t);
      $('#inv-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- Dane: JSON / CSV / demo ---------- */
  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: filename, rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    downloadBlob(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'kalkulator-dn-2026' }, null, 2), `dn2026-kopia-${todayISO()}.json`, 'application/json');
    toast('Pobrano kopię zapasową JSON. Zawiera Twoje dane – przechowuj ją bezpiecznie.');
  }
  function importJson(file) {
    if (file.size > CONFIG.MAX_IMPORT_BYTES) { toast('Plik jest za duży (maks. 5 MB).', 'red'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('Nie udało się odczytać pliku.', 'red');
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { toast('To nie jest prawidłowy plik JSON.', 'red'); return; }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.transactions)) { toast('Plik nie zawiera ewidencji z tego kalkulatora.', 'red'); return; }
      const { state: next, dropped } = sanitizeState(parsed);
      const acc = next.settings.seller.account;
      const accInfo = acc ? `\nNumer konta w pliku: ${formatIban(acc)} – sprawdź, czy jest Twój.` : '';
      if (!confirm(`Wczytać ${next.transactions.length} pozycji? Obecne dane (${state.transactions.length} pozycji) zostaną zastąpione.${accInfo}`)) return;
      state = next;
      save(); applySettingsToInputs(); applyChecklist(); resetTxForm(); resetInvoiceForm(); renderVerifier(); renderAll();
      toast(`Wczytano ${next.transactions.length} pozycji` + (dropped ? `, pominięto ${dropped} nieprawidłowych lub spoza ${YEAR} r.` : '.'));
    };
    reader.readAsText(file);
  }
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r＝＋－＠]/.test(s)) s = "'" + s; // ochrona przed formułami w arkuszu
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCsv() {
    const sorted = sortTx(state.transactions);
    const cum = cumulativeInQuarter(sorted);
    const lines = [['Lp.', 'Data sprzedaży', 'Kwartał', 'Rodzaj dokumentu', 'Nr dokumentu', 'Nabywca', 'Typ nabywcy', 'NIP', 'Opis', 'Kwota brutto (zł)', 'Narastająco w kwartale (zł)', 'Status', 'Data zapłaty', 'Koszt (zł)']];
    sorted.forEach((t, i) => lines.push([i + 1, fmtDate(t.date), Q_NAMES[quarterOf(t.date) - 1], DOC_LABEL[t.docType], t.docNo, t.client, t.buyerType.toUpperCase(), t.nip, t.desc, plainNum(t.amount), plainNum(cum.get(t.id)), t.paid ? 'Opłacone' : 'Należne', fmtDate(t.paidDate), plainNum(t.cost)]));
    downloadBlob('﻿' + lines.map(r => r.map(csvCell).join(';')).join('\r\n'), `ewidencja-sprzedazy-${YEAR}.csv`, 'text/csv;charset=utf-8');
  }
  function demoData() {
    const d = (date, amount, opts) => ({ date, amount, paid: true, paidDate: date, docType: 'rachunek', buyerType: 'b2c', client: '', nip: '', desc: '', cost: 0, ...opts });
    return [
      d('2026-01-12', 500000, { docNo: '1/2026', client: 'Anna Kowalska', desc: 'Korepetycje z matematyki – styczeń' }),
      d('2026-02-09', 400000, { docNo: '2/2026', client: 'Anna Kowalska', desc: 'Korepetycje z matematyki – luty' }),
      d('2026-03-16', 150000, { docType: 'brak', desc: 'Rękodzieło – sprzedaż na targach', cost: 32000 }),
      d('2026-04-08', 320000, { docNo: '3/2026', client: 'Jan Nowak', desc: 'Projekt logo' }),
      d('2026-05-20', 410000, { docType: 'faktura', docNo: 'F/1/2026', buyerType: 'b2b', client: 'Przykładowa Firma sp. z o.o.', nip: '1234563218', desc: 'Teksty na stronę www', paid: false, paidDate: '' }),
      d('2026-07-03', 600000, { docNo: '4/2026', client: 'Ewa Wiśniewska', desc: 'Sesja zdjęciowa – ślub', cost: 45000 }),
      d('2026-08-14', 350000, { docNo: '5/2026', client: 'Piotr Zieliński', desc: 'Sesja zdjęciowa – rodzinna' }),
      d('2026-09-02', 155000, { docNo: '6/2026', client: 'Marta Lewandowska', desc: 'Sesja zdjęciowa – portret', paid: false, paidDate: '' }),
      d('2026-10-06', 240000, { docNo: '7/2026', client: 'Anna Kowalska', desc: 'Korepetycje – październik' })
    ].map((t, i) => sanitizeTx({ ...t, id: 'demo' + (i + 1), created: Date.now() + i }));
  }

  /* ---------- Ustawienia ---------- */
  // Dozwolone ścieżki ustawień (atrybuty data-setting w index.html).
  const SETTING_PATHS = new Set(['seller.name', 'seller.street', 'seller.city', 'seller.idType', 'seller.idValue', 'seller.account', 'seller.contact', 'vatBasis', 'place', 'paymentDays', 'etatIncome', 'extraCosts']);
  function getSetting(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state.settings); }
  function setSetting(path, value) {
    if (!SETTING_PATHS.has(path)) return;
    const keys = path.split('.');
    let o = state.settings;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
    state.settings = sanitizeSettings(state.settings);
  }
  function applySettingsToInputs() {
    $$('[data-setting]').forEach(inp => { const v = getSetting(inp.dataset.setting); inp.value = v == null ? '' : v; });
  }
  function applyChecklist() {
    $$('[data-verify]').forEach(i => { i.checked = state.checklist[i.dataset.verify] === true; });
  }

  /* ---------- Rachunek ---------- */
  function bumpCounter(kind, no) {
    const m = /^(?:F\/)?(\d{1,6})\/(\d{4})$/.exec(no || '');
    if (m && Number(m[2]) === YEAR && state.settings.nextNo[kind]) state.settings.nextNo[kind] = Math.min(999999, Math.max(state.settings.nextNo[kind], Number(m[1]) + 1));
  }
  function suggestedNo(kind) {
    const n = state.settings.nextNo[kind] || 1;
    return kind === 'faktura' ? `F/${n}/${YEAR}` : `${n}/${YEAR}`;
  }
  function addItemRow(item) {
    if ($('#inv-items').children.length >= 50) { toast('Maksymalnie 50 pozycji na dokumencie.', 'amber'); return; }
    const tr = el('tr', { class: 'align-top' },
      el('td', { class: 'min-w-[11rem] px-2 py-1' }, el('input', { class: 'input', 'data-f': 'name', maxlength: '160', 'aria-label': 'Nazwa towaru lub usługi', value: item ? item.name : '' })),
      el('td', { class: 'px-2 py-1' }, el('input', { class: 'input tabular-nums', 'data-f': 'qty', inputmode: 'decimal', maxlength: '12', 'aria-label': 'Ilość', value: item ? item.qty : '1' })),
      el('td', { class: 'px-2 py-1' }, el('input', { class: 'input', 'data-f': 'unit', list: 'units', maxlength: '10', 'aria-label': 'Jednostka miary', value: item ? item.unit : 'usł.' })),
      el('td', { class: 'px-2 py-1' }, el('input', { class: 'input tabular-nums', 'data-f': 'price', inputmode: 'decimal', maxlength: '20', placeholder: '0,00', 'aria-label': 'Cena jednostkowa w zł', value: item ? item.price : '' })),
      el('td', { class: 'px-2 py-1 pt-3 text-right tabular-nums', 'data-f': 'value', text: '0,00 zł' }),
      el('td', { class: 'px-2 py-1' }, el('button', { type: 'button', class: 'btn-secondary btn-sm mt-1', 'data-remove-item': '', 'aria-label': 'Usuń pozycję', text: '×' })));
    $('#inv-items').append(tr);
    recalcInvoice();
  }
  function readItems() {
    return $$('#inv-items tr').map(tr => {
      const name = str($('[data-f="name"]', tr).value, 160);
      const qty = parseQty($('[data-f="qty"]', tr).value);
      const unit = str($('[data-f="unit"]', tr).value, 10);
      const price = parseMoney($('[data-f="price"]', tr).value);
      const value = qty > 0 && price >= 0 ? Math.round(qty * price) : NaN;
      return { tr, name, qty, unit, price, value: value <= CONFIG.MAX_AMOUNT_GR ? value : NaN };
    });
  }
  function recalcInvoice() {
    let total = 0;
    for (const it of readItems()) {
      $('[data-f="value"]', it.tr).textContent = Number.isNaN(it.value) ? '—' : fmt(it.value);
      if (!Number.isNaN(it.value)) total += it.value;
    }
    $('#inv-total').textContent = fmt(total);
    const issue = $('#inv-issue').value;
    const days = parseInt($('#inv-days').value, 10);
    $('#inv-due').textContent = isValidISO(issue) && days >= 0 && days <= 365 ? `Termin: ${fmtDate(addDaysISO(issue, days))} r.` : '';
    renderInvoiceInfo(total);
    return total;
  }
  function renderInvoiceInfo(total) {
    const kind = $('#inv-kind').value;
    const b2b = $('#inv-buyer-type').value === 'b2b';
    $('#inv-title').textContent = kind === 'faktura' ? 'Faktura bez VAT – PDF' : 'Rachunek PDF';
    $('#btn-inv-pdf').textContent = kind === 'faktura' ? 'Pobierz fakturę PDF' : 'Pobierz rachunek PDF';
    const box = $('#inv-info');
    box.replaceChildren();
    // Numer konta pokazujemy przy każdym dokumencie – łatwo zauważyć literówkę lub podmianę.
    if ($('#inv-pay-method').value === 'przelew') {
      const acc = state.settings.seller.account;
      if (!acc) box.append(alertBox('amber', 'Brak numeru konta', ['Na dokumencie z płatnością przelewem nie będzie numeru rachunku. Uzupełnij go w sekcji „Twoje dane”.']));
      else if (!ibanValid(acc)) box.append(alertBox('red', 'Nieprawidłowy numer konta', ['Popraw numer rachunku w sekcji „Twoje dane” – dokument nie zostanie wygenerowany z błędnym numerem.']));
      else box.append(el('p', { class: 'text-slate-700' }, 'Numer konta na dokumencie: ', el('strong', { class: 'tabular-nums', text: formatIban(acc) }), ' – sprawdź, czy to Twoje konto.'));
    }
    if (kind === 'rachunek') {
      box.append(el('p', { class: 'text-slate-600', text: 'Rachunek nie jest fakturą i nie podlega KSeF. Jeśli nabywca zażąda faktury, wybierz „Faktura bez VAT”.' }));
      return;
    }
    box.append(el('p', { class: 'text-slate-600', text: 'Do wystawiania faktur w KSeF potrzebny jest NIP sprzedawcy.' }));
    const sale = $('#inv-sale').value;
    if (b2b && isValidISO(sale) && parseISO(sale).m >= CONFIG.KSEF_FROM_MONTH && total > 0) {
      const m = parseISO(sale).m;
      const k = computeKsef(state.transactions.filter(t => t.id !== linkedTxId));
      const after = k.months[m - 1].sum + total;
      if (k.lostFrom && m >= k.lostFrom) box.append(alertBox('red', 'KSeF obowiązkowy', [`Limit 10 000 zł przekroczono w ${MONTHS_LOC[k.lostFrom - 1]} – faktury dla firm wystawiaj w KSeF.`]));
      else if (after > CONFIG.KSEF_MONTHLY_LIMIT_GR) box.append(alertBox('red', 'Ta faktura przekroczy limit KSeF', [`Faktury B2B w ${MONTHS_LOC[m - 1]}: ${fmt(after)} – ponad 10 000 zł. Tę fakturę i kolejne wystaw w KSeF.`]));
      else box.append(alertBox('teal', 'W limicie KSeF', [`Faktury B2B w ${MONTHS_LOC[m - 1]} po tej fakturze: ${fmt(after)} z 10 000 zł.`]));
    }
  }
  function resetInvoiceForm() {
    linkedTxId = null;
    $('#inv-linked').hidden = true;
    $('#inv-kind').value = 'rachunek';
    setAutoInvNo();
    $('#inv-issue').value = todayISO();
    $('#inv-sale').value = defaultDate();
    $('#inv-buyer-type').value = 'b2c';
    ['#inv-buyer-name', '#inv-buyer-address', '#inv-buyer-nip', '#inv-notes'].forEach(s => { $(s).value = ''; });
    $('#inv-pay-method').value = 'przelew';
    $('#inv-paid').checked = false;
    $('#inv-add-ledger').checked = true;
    $('#inv-items').replaceChildren();
    addItemRow();
    $('#inv-error').textContent = '';
    recalcInvoice();
  }
  function prefillInvoiceFromTx(t) {
    resetInvoiceForm();
    linkedTxId = t.id;
    const kind = t.docType === 'faktura' ? 'faktura' : 'rachunek';
    $('#inv-kind').value = kind;
    if (t.docNo && t.docType === kind) { $('#inv-no').value = t.docNo; autoInvNo = ''; } else setAutoInvNo();
    $('#inv-sale').value = t.date;
    $('#inv-buyer-type').value = t.buyerType;
    $('#inv-buyer-name').value = t.client;
    $('#inv-buyer-nip').value = t.nip;
    $('#inv-paid').checked = t.paid;
    $('#inv-items').replaceChildren();
    addItemRow({ name: t.desc || 'Sprzedaż', qty: '1', unit: 'usł.', price: plainNum(t.amount) });
    $('#inv-linked').textContent = `Powiązano z pozycją ewidencji z ${fmtDate(t.date)} (${fmt(t.amount)}) – zostanie zaktualizowana.`;
    $('#inv-linked').hidden = false;
    recalcInvoice();
  }

  async function onInvoiceSubmit(e) {
    e.preventDefault();
    const errors = [];
    const s = state.settings.seller;
    const kind = $('#inv-kind').value === 'faktura' ? 'faktura' : 'rachunek';
    const no = str($('#inv-no').value, 40);
    const issue = $('#inv-issue').value;
    const sale = $('#inv-sale').value;
    const buyerName = str($('#inv-buyer-name').value, 120);
    const buyerNip = str($('#inv-buyer-nip').value, 20);
    const payMethod = ['przelew', 'gotówka', 'BLIK', 'karta'].includes($('#inv-pay-method').value) ? $('#inv-pay-method').value : 'przelew';
    const items = readItems().filter(it => it.name || it.price);
    const seller = sellerProblems();
    if (!s.name) errors.push('Uzupełnij imię i nazwisko sprzedawcy (sekcja „Twoje dane”).');
    if (seller.account) errors.push('Popraw numer konta w sekcji „Twoje dane”.');
    if (seller.id) errors.push('Popraw NIP/PESEL w sekcji „Twoje dane”.');
    if (!no) errors.push('Podaj numer dokumentu.');
    if (!isValidISO(issue)) errors.push('Podaj datę wystawienia.');
    if (!isValidISO(sale) || parseISO(sale).y !== YEAR) errors.push(`Podaj datę sprzedaży z roku ${YEAR}.`);
    if (!buyerName) errors.push('Podaj nabywcę.');
    if (!nipAcceptable(buyerNip)) errors.push('Nieprawidłowy NIP nabywcy.');
    if (!items.length) errors.push('Dodaj co najmniej jedną pozycję.');
    if (items.some(it => !it.name || Number.isNaN(it.value))) errors.push('Uzupełnij nazwę, ilość i cenę w każdej pozycji.');
    const total = items.reduce((a, it) => a + (Number.isNaN(it.value) ? 0 : it.value), 0);
    if (items.length && !(total > 0)) errors.push('Wartość dokumentu musi być większa od zera.');
    if (total > CONFIG.MAX_AMOUNT_GR) errors.push('Wartość dokumentu jest za duża.');
    $('#inv-error').textContent = errors.join(' ');
    if (errors.length) return;
    const addLedger = $('#inv-add-ledger').checked;
    if (addLedger) {
      const dup = state.transactions.find(t => t.docType === kind && t.docNo === no && t.id !== linkedTxId);
      if (dup && !confirm(`W ewidencji jest już dokument nr ${no}. Kontynuować?`)) return;
    }

    const days = Math.min(365, Math.max(0, parseInt($('#inv-days').value, 10) || 0));
    const doc = {
      kind, no, issue, sale, place: str($('#inv-place').value, 60),
      buyer: { type: $('#inv-buyer-type').value === 'b2b' ? 'b2b' : 'b2c', name: buyerName, address: str($('#inv-buyer-address').value, 160), nip: buyerNip },
      items: items.map(({ name, qty, unit, price, value }) => ({ name, qty, unit, price, value })),
      total, payMethod, dueDate: addDaysISO(issue, days),
      paid: $('#inv-paid').checked, notes: str($('#inv-notes').value, 300)
    };
    const ok = await makePdf(buildInvoicePdf(doc), `${kind}-${no.replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`, $('#btn-inv-pdf'));
    if (!ok) return;

    bumpCounter(kind, no);
    refreshAutoNumbers();
    if (addLedger) {
      const linked = linkedTxId ? state.transactions.find(t => t.id === linkedTxId) : null;
      upsertTx({
        date: sale, amount: total, docType: kind, docNo: no, buyerType: doc.buyer.type, client: buyerName, nip: buyerNip,
        desc: doc.items.map(it => it.name).join('; ').slice(0, 200),
        paid: doc.paid, paidDate: doc.paid ? (linked && linked.paid ? linked.paidDate : issue) : ''
      }, linked ? linked.id : null);
      toast(linked ? 'Dokument pobrany, pozycja ewidencji zaktualizowana.' : 'Dokument pobrany i dodany do ewidencji.');
    } else {
      save();
    }
    resetInvoiceForm();
    showSupport();
  }

  /* ---------- PDF (pdfmake z tej samej domeny, ładowany na żądanie) ---------- */
  // Trusted Types: przeglądarka przyjmie adres skryptu tylko z listy PDF_SCRIPTS.
  const scriptPolicy = window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function'
    ? window.trustedTypes.createPolicy('dn-loader', {
      createScriptURL: url => {
        if (!PDF_SCRIPTS.includes(url)) throw new TypeError('Niedozwolony skrypt: ' + url);
        return url;
      }
    })
    : null;
  let pdfLoading = null;
  function loadScript(src) {
    if (!PDF_SCRIPTS.includes(src)) return Promise.reject(new Error('Niedozwolony skrypt'));
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = scriptPolicy ? scriptPolicy.createScriptURL(src) : src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Nie udało się wczytać ' + src));
      document.head.append(s);
    });
  }
  function loadPdfMake() {
    if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve();
    if (!pdfLoading) {
      pdfLoading = loadScript(PDF_SCRIPTS[0]).then(() => loadScript(PDF_SCRIPTS[1])).catch(err => { pdfLoading = null; throw err; });
    }
    return pdfLoading;
  }
  async function makePdf(docDef, filename, button) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Generowanie PDF…';
    try {
      await loadPdfMake();
      window.pdfMake.createPdf(docDef).download(filename);
      return true;
    } catch (err) {
      toast('Nie udało się wygenerować PDF. Odśwież stronę i spróbuj ponownie.', 'red');
      return false;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  const PDF_STYLES = {
    title: { fontSize: 15, bold: true, color: '#0f172a' },
    subtitle: { fontSize: 9, color: '#475569' },
    th: { bold: true, fontSize: 8, color: '#0f172a', fillColor: '#e2e8f0' },
    label: { fontSize: 7.5, bold: true, color: '#64748b' },
    small: { fontSize: 7.5, color: '#475569' }
  };
  const TABLE_LAYOUT = {
    hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
    vLineWidth: () => 0.4,
    hLineColor: () => '#94a3b8',
    vLineColor: () => '#cbd5e1',
    paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 4, paddingRight: () => 4
  };
  function pdfFooter(note) {
    return (page, pages) => ({
      margin: [40, 12, 40, 0],
      columns: [
        { text: note, style: 'small' },
        { text: `Strona ${page} z ${pages}`, style: 'small', alignment: 'right', width: 70 }
      ]
    });
  }
  function sellerLines() {
    const s = state.settings.seller;
    return [s.name, s.street, s.city, s.idValue ? `${s.idType}: ${s.idValue}` : '', s.contact].filter(Boolean);
  }

  function periodInfo(key) {
    if (key === 'y') return { type: 'y', title: `Uproszczona Ewidencja Sprzedaży – rok ${YEAR}`, from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, test: () => true, file: `ewidencja-sprzedazy-${YEAR}.pdf` };
    const n = Number(String(key).slice(1));
    if (key[0] === 'q' && n >= 1 && n <= 4) {
      return { type: 'q', q: n, title: `Uproszczona Ewidencja Sprzedaży – Kwartał ${Q_NAMES[n - 1]} / ${YEAR}`, from: firstOfMonthISO(YEAR, n * 3 - 2), to: endOfMonthISO(YEAR, n * 3), test: t => quarterOf(t.date) === n, file: `ewidencja-sprzedazy-Q${n}-${YEAR}.pdf` };
    }
    const m = key[0] === 'm' && n >= 1 && n <= 12 ? n : 1;
    const name = MONTHS[m - 1];
    return { type: 'm', m, q: Math.floor((m - 1) / 3) + 1, title: `Uproszczona Ewidencja Sprzedaży – ${name[0].toUpperCase() + name.slice(1)} ${YEAR}`, from: firstOfMonthISO(YEAR, m), to: endOfMonthISO(YEAR, m), test: t => parseISO(t.date).m === m, file: `ewidencja-sprzedazy-${YEAR}-${pad(m)}.pdf` };
  }

  function buildLedgerPdf(key, withDetails) {
    const per = periodInfo(key);
    const sorted = sortTx(state.transactions);
    const cum = cumulativeInQuarter(sorted);
    const items = sorted.filter(per.test);
    const Q = computeQuarters(state.transactions);
    const head = ['Lp.', 'Data sprzedaży', 'Nr dokumentu'].concat(withDetails ? ['Nabywca / opis'] : []).concat(['Kwota (zł)', 'Narastająco w kwartale (zł)']);
    const widths = withDetails ? [22, 60, 60, '*', 62, 74] : [24, 70, '*', 80, 110];
    const cols = head.length;
    const body = [head.map((h, i) => ({ text: h, style: 'th', alignment: i >= cols - 2 ? 'right' : 'left' }))];
    const subtotal = (q, sum) => {
      const row = [{ text: `Razem ${Q_NAMES[q - 1]} kwartał`, colSpan: cols - 2, bold: true, fillColor: '#f1f5f9' }];
      for (let i = 1; i < cols - 2; i++) row.push({});
      row.push({ text: fmtNum(sum), bold: true, alignment: 'right', fillColor: '#f1f5f9' }, { text: sum > CAP ? 'ponad limit' : `limit ${fmtNum(CAP)}`, alignment: 'right', fillColor: '#f1f5f9', color: sum > CAP ? '#b91c1c' : '#475569', fontSize: 7.5 });
      body.push(row);
    };
    let lp = 0, total = 0, unpaid = 0, curQ = null, qSum = 0;
    for (const t of items) {
      const q = quarterOf(t.date);
      if (per.type === 'y' && curQ !== null && q !== curQ) { subtotal(curQ, qSum); qSum = 0; }
      curQ = q;
      lp++; total += t.amount; qSum += t.amount;
      if (!t.paid) unpaid += t.amount;
      const c = cum.get(t.id);
      const row = [String(lp), fmtDate(t.date), t.docNo || (t.docType === 'brak' ? '—' : DOC_LABEL[t.docType])];
      if (withDetails) row.push({ text: [t.client || (t.buyerType === 'b2b' ? 'Firma' : 'Osoba prywatna'), t.desc ? { text: '\n' + t.desc, color: '#475569', fontSize: 7.5 } : ''] });
      row.push({ text: fmtNum(t.amount), alignment: 'right' }, { text: fmtNum(c), alignment: 'right', color: c > CAP ? '#b91c1c' : '#0f172a', bold: c > CAP });
      body.push(row);
    }
    if (per.type === 'y' && curQ !== null) subtotal(curQ, qSum);
    if (!items.length) {
      const row = [{ text: 'Brak sprzedaży w tym okresie.', colSpan: cols, alignment: 'center', color: '#64748b', margin: [0, 6, 0, 6] }];
      for (let i = 1; i < cols; i++) row.push({});
      body.push(row);
    }

    const summary = [
      [{ text: 'Przychód należny w okresie', style: 'label' }, { text: fmt(total), alignment: 'right', bold: true }],
      [{ text: 'w tym nieopłacone', style: 'label' }, { text: fmt(unpaid), alignment: 'right' }]
    ];
    if (per.type !== 'y') {
      const q = Q[per.q - 1];
      const qDue = per.type === 'q' ? q.due : (items.length ? cum.get(items[items.length - 1].id) : sorted.filter(t => quarterOf(t.date) === per.q && t.date <= per.to).reduce((a, t) => a + t.amount, 0));
      if (per.type === 'm') summary.push([{ text: `Narastająco w ${Q_NAMES[per.q - 1]} kwartale (do ${fmtDate(per.to)})`, style: 'label' }, { text: fmt(qDue), alignment: 'right' }]);
      summary.push([{ text: `Limit kwartalny (225% × ${fmtNum(CONFIG.MIN_WAGE_GR)} zł)`, style: 'label' }, { text: fmt(CAP), alignment: 'right' }]);
      summary.push(qDue > CAP
        ? [{ text: 'Przekroczenie limitu', style: 'label', color: '#b91c1c' }, { text: fmt(qDue - CAP), alignment: 'right', bold: true, color: '#b91c1c' }]
        : [{ text: 'Pozostało do limitu', style: 'label' }, { text: fmt(CAP - qDue), alignment: 'right' }]);
      if (per.type === 'q' && q.exceedDate) summary.push([{ text: 'Data przekroczenia / termin CEIDG', style: 'label', color: '#b91c1c' }, { text: `${fmtDate(q.exceedDate)} / ${fmtDate(addDaysISO(q.exceedDate, 7))}`, alignment: 'right', color: '#b91c1c' }]);
    } else {
      Q.forEach((q, i) => summary.push([{ text: `${Q_NAMES[i]} kwartał`, style: 'label' }, { text: `${fmt(q.due)}${q.due > CAP ? ' (ponad limit)' : ''}`, alignment: 'right', color: q.due > CAP ? '#b91c1c' : '#0f172a' }]));
    }

    const seller = sellerLines();
    return {
      pageSize: 'A4',
      pageMargins: [40, 45, 40, 50],
      info: { title: per.title, author: state.settings.seller.name || '', subject: 'Uproszczona ewidencja sprzedaży – działalność nierejestrowana', creator: 'Kalkulator DN 2026' },
      defaultStyle: { font: 'Roboto', fontSize: 8.5, color: '#0f172a', lineHeight: 1.15 },
      styles: PDF_STYLES,
      footer: pdfFooter(`Wygenerowano ${fmtDate(todayISO())} r. · Działalność nierejestrowana (art. 5 ust. 1 Prawa przedsiębiorców) · ewidencja sprzedaży (art. 109 ust. 1 ustawy o VAT)`),
      content: [
        { text: per.title, style: 'title' },
        { text: `Okres: ${fmtDate(per.from)} – ${fmtDate(per.to)}`, style: 'subtitle', margin: [0, 2, 0, 10] },
        { columns: [
          { width: '*', stack: [{ text: 'PROWADZĄCY EWIDENCJĘ', style: 'label' }].concat(seller.length ? seller.map(l => ({ text: l })) : [{ text: '(uzupełnij dane w kalkulatorze)', color: '#94a3b8' }]) },
          { width: 'auto', stack: [{ text: 'LIMIT PRZYCHODU NALEŻNEGO', style: 'label', alignment: 'right' }, { text: `${fmt(CAP)} na kwartał`, alignment: 'right', bold: true }, { text: `225% minimalnego wynagrodzenia (${fmtNum(CONFIG.MIN_WAGE_GR)} zł)`, alignment: 'right', style: 'small' }] }
        ], margin: [0, 0, 0, 12] },
        { table: { headerRows: 1, widths, body, dontBreakRows: true }, layout: TABLE_LAYOUT },
        { columns: [
          { width: '*', text: '' },
          { width: 260, table: { widths: ['*', 'auto'], body: summary }, layout: 'lightHorizontalLines' }
        ], margin: [0, 12, 0, 0] },
        { columns: [
          { width: '*', text: 'Wpisu dokonuje się za każdy dzień sprzedaży, najpóźniej przed pierwszą sprzedażą w dniu następnym. Do limitu wlicza się przychód należny – także nieopłacony.', style: 'small' },
          { width: 180, stack: [{ text: '\n\n.............................................', alignment: 'center', color: '#94a3b8' }, { text: 'podpis prowadzącego ewidencję', style: 'small', alignment: 'center' }] }
        ], margin: [0, 18, 0, 0] }
      ]
    };
  }

  function buildInvoicePdf(d) {
    const isFv = d.kind === 'faktura';
    const title = `${isFv ? 'FAKTURA' : 'RACHUNEK'} nr ${d.no}`;
    const buyer = [d.buyer.name, d.buyer.address, d.buyer.nip ? `NIP: ${d.buyer.nip}` : ''].filter(Boolean);
    const s = state.settings.seller;
    const party = (label, lines) => ({ width: '*', stack: [{ text: label, style: 'label', margin: [0, 0, 0, 3] }].concat(lines.map((l, i) => ({ text: l, bold: i === 0 }))) });
    const itemsBody = [[
      { text: 'Lp.', style: 'th' }, { text: 'Nazwa towaru / usługi', style: 'th' }, { text: 'Ilość', style: 'th', alignment: 'right' },
      { text: 'J.m.', style: 'th' }, { text: 'Cena jedn. (zł)', style: 'th', alignment: 'right' }, { text: 'Wartość (zł)', style: 'th', alignment: 'right' }
    ]];
    d.items.forEach((it, i) => itemsBody.push([
      String(i + 1), it.name, { text: String(it.qty).replace('.', ','), alignment: 'right' }, it.unit,
      { text: fmtNum(it.price), alignment: 'right' }, { text: fmtNum(it.value), alignment: 'right' }
    ]));
    itemsBody.push([{ text: 'Razem', colSpan: 5, alignment: 'right', bold: true, fillColor: '#f1f5f9' }, {}, {}, {}, {}, { text: fmtNum(d.total), alignment: 'right', bold: true, fillColor: '#f1f5f9' }]);
    const payRows = [
      [{ text: 'Sposób zapłaty', style: 'label' }, d.payMethod],
      [{ text: 'Termin zapłaty', style: 'label' }, d.paid ? 'zapłacono' : fmtDate(d.dueDate)]
    ];
    if (d.payMethod === 'przelew' && s.account && ibanValid(s.account)) payRows.push([{ text: 'Numer rachunku', style: 'label' }, formatIban(s.account)]);
    return {
      pageSize: 'A4',
      pageMargins: [40, 45, 40, 50],
      info: { title, author: s.name || '', subject: isFv ? 'Faktura bez VAT' : 'Rachunek', creator: 'Kalkulator DN 2026' },
      defaultStyle: { font: 'Roboto', fontSize: 9, color: '#0f172a', lineHeight: 1.2 },
      styles: PDF_STYLES,
      footer: pdfFooter(`${title} · wygenerowano ${fmtDate(todayISO())} r.`),
      content: [
        { columns: [
          { width: '*', stack: [{ text: title, style: 'title', fontSize: 17 }, { text: isFv ? 'Faktura bez VAT – sprzedawca zwolniony z VAT' : 'Dokument sprzedaży bez VAT', style: 'subtitle' }] },
          { width: 'auto', table: { body: [
            [{ text: 'Miejsce wystawienia', style: 'label' }, d.place || '—'],
            [{ text: 'Data wystawienia', style: 'label' }, fmtDate(d.issue)],
            [{ text: 'Data sprzedaży / wykonania usługi', style: 'label' }, fmtDate(d.sale)]
          ] }, layout: 'noBorders' }
        ] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: '#cbd5e1' }], margin: [0, 10, 0, 10] },
        { columns: [party('SPRZEDAWCA', sellerLines()), party('NABYWCA', buyer)], columnGap: 24 },
        { table: { headerRows: 1, widths: [20, '*', 40, 34, 70, 74], body: itemsBody }, layout: TABLE_LAYOUT, margin: [0, 16, 0, 0] },
        { columns: [
          { width: '*', table: { body: payRows }, layout: 'noBorders', margin: [0, 10, 0, 0] },
          { width: 'auto', stack: [
            { text: `Razem: ${fmt(d.total)}`, bold: true, fontSize: 11, alignment: 'right' },
            { text: `Słownie: ${amountInWords(d.total)}`, alignment: 'right', style: 'small', margin: [0, 2, 0, 4] },
            { text: d.paid ? `Zapłacono: ${fmt(d.total)}` : `Do zapłaty: ${fmt(d.total)}`, alignment: 'right', bold: true }
          ], margin: [0, 10, 0, 0] }
        ] },
        { text: `Sprzedawca korzysta ze zwolnienia podmiotowego z podatku VAT na podstawie art. 113 ust. ${state.settings.vatBasis} ustawy z dnia 11 marca 2004 r. o podatku od towarów i usług (limit 240 000 zł w 2026 r.).`, margin: [0, 18, 0, 0], fontSize: 8.5 },
        { text: 'Sprzedaż w ramach działalności nierejestrowanej (art. 5 ust. 1 ustawy z dnia 6 marca 2018 r. – Prawo przedsiębiorców).', fontSize: 8.5, margin: [0, 2, 0, 0] },
        d.notes ? { text: [{ text: 'Uwagi: ', bold: true }, d.notes], margin: [0, 8, 0, 0], fontSize: 8.5 } : '',
        { columns: [
          { width: '*', stack: [{ text: '\n\n.............................................', alignment: 'center', color: '#94a3b8' }, { text: 'podpis osoby uprawnionej do odbioru', style: 'small', alignment: 'center' }] },
          { width: '*', stack: [{ text: '\n\n.............................................', alignment: 'center', color: '#94a3b8' }, { text: 'podpis osoby uprawnionej do wystawienia', style: 'small', alignment: 'center' }] }
        ], margin: [0, 28, 0, 0] }
      ]
    };
  }

  async function onLedgerPdf() {
    const key = $('#ledger-period').value;
    const per = periodInfo(key);
    const ok = await makePdf(buildLedgerPdf(key, $('#ledger-details').checked), per.file, $('#btn-ledger-pdf'));
    if (ok) {
      $('#ledger-msg').textContent = state.settings.seller.name ? '' : 'Wskazówka: uzupełnij „Twoje dane”, aby na ewidencji pojawił się prowadzący.';
      showSupport();
    }
  }

  /* ---------- Wsparcie (BuyCoffee) ---------- */
  function setupSupport() {
    const ok = !!USER.buycoffee;
    $('#support-footer').hidden = !ok;
    $$('[data-buycoffee]').forEach(a => { if (ok) a.href = USER.buycoffee; else a.removeAttribute('href'); });
    return ok;
  }
  function showSupport() {
    if (!setupSupport()) return;
    try { if (sessionStorage.getItem('dn2026-support-shown')) return; sessionStorage.setItem('dn2026-support-shown', '1'); } catch (e) { /* brak pamięci sesji */ }
    const dlg = $('#support-dialog');
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  }

  /* ---------- Start ---------- */
  function init() {
    load();
    applySettingsToInputs();
    applyChecklist();
    resetTxForm();
    resetInvoiceForm();
    setupSupport();
    const cq = currentQuarter();
    $('#ledger-period').value = cq ? 'q' + cq : 'y';

    $('#tx-form').addEventListener('submit', onTxSubmit);
    $('#tx-cancel').addEventListener('click', resetTxForm);
    $('#tx-status').addEventListener('change', syncPaidDate);
    $('#tx-date').addEventListener('change', () => { if ($('#tx-status').value === 'paid' && !editingId) $('#tx-paid-date').value = $('#tx-date').value; });
    $('#tx-doc-type').addEventListener('change', () => {
      if (editingId) return;
      const current = $('#tx-doc-no').value;
      if (!current || current === autoTxNo) setAutoTxNo();
    });
    $('#tx-body').addEventListener('click', onTableClick);
    $('#tx-filter').addEventListener('change', renderTable);

    $('#btn-export-json').addEventListener('click', exportJson);
    $('#input-import-json').addEventListener('change', e => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#btn-demo').addEventListener('click', () => {
      if (state.transactions.length && !confirm('Przykładowe dane zastąpią obecną ewidencję. Najpierw zrób kopię JSON. Kontynuować?')) return;
      state.transactions = demoData();
      state.transactions.forEach(t => { if (t.docType !== 'brak') bumpCounter(t.docType, t.docNo); });
      save(); resetTxForm(); resetInvoiceForm(); renderAll();
      toast('Wczytano przykładowe dane: I kw. ostrzeżenie, III kw. przekroczenie limitu.');
    });
    $('#btn-clear').addEventListener('click', () => {
      if (!confirm('Usunąć całą ewidencję, ustawienia i dane sprzedawcy z tej przeglądarki? Tej operacji nie można cofnąć.')) return;
      wipeStorage();
      state = emptyState();
      save(); applySettingsToInputs(); applyChecklist(); resetTxForm(); resetInvoiceForm(); renderVerifier(); renderAll();
      toast('Dane usunięte z tej przeglądarki.');
    });

    $$('[data-setting]').forEach(inp => {
      const handler = () => {
        setSetting(inp.dataset.setting, str(inp.value, 160));
        save();
        if (['etatIncome', 'extraCosts'].includes(inp.dataset.setting)) renderPit();
        if (inp.dataset.setting === 'paymentDays') recalcInvoice();
        if (inp.dataset.setting.startsWith('seller.')) { renderSellerErrors(); recalcInvoice(); }
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
    $('#jdg-start').addEventListener('change', e => {
      if (!isValidISO(e.target.value)) return;
      state.settings.jdgStart = e.target.value; save(); renderJdg(computeQuarters(state.transactions));
    });
    $$('[data-verify]').forEach(i => i.addEventListener('change', () => {
      state.checklist[i.dataset.verify] = i.checked; save(); renderVerifier(); renderKasa();
    }));
    $$('input[name="kasa-prev"]').forEach(r => r.addEventListener('change', () => {
      state.settings.kasaPrev = ['new', 'under', 'over'].includes(r.value) ? r.value : 'new'; save(); renderKasa();
    }));

    $('#btn-ledger-pdf').addEventListener('click', onLedgerPdf);
    $('#inv-form').addEventListener('submit', onInvoiceSubmit);
    $('#btn-inv-reset').addEventListener('click', resetInvoiceForm);
    $('#inv-add-item').addEventListener('click', () => addItemRow());
    $('#inv-items').addEventListener('input', recalcInvoice);
    $('#inv-items').addEventListener('click', e => {
      if (!e.target.closest('[data-remove-item]')) return;
      e.target.closest('tr').remove();
      if (!$('#inv-items').children.length) addItemRow();
      recalcInvoice();
    });
    $('#inv-kind').addEventListener('change', () => {
      if (!$('#inv-no').value || $('#inv-no').value === autoInvNo) setAutoInvNo();
      recalcInvoice();
    });
    ['#inv-issue', '#inv-sale', '#inv-buyer-type', '#inv-days', '#inv-pay-method'].forEach(s => $(s).addEventListener('change', recalcInvoice));
    $('#support-close').addEventListener('click', () => $('#support-dialog').close());

    renderVerifier();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
