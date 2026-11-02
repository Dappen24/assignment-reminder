// Pure logic: PDF text -> weeks -> reminders, contact matching, message building.
// Works in the browser (window.AR) and in Node (module.exports) for testing.
(function (root) {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];

  const DEFAULT_TEMPLATES = {
    chairman: 'Hola {saludo}, le recuerdo que tiene la presidencia de la reunión del {fecha}. ¡Muchas gracias!',
    prayer: 'Hola {saludo}, le recuerdo que tiene la oración de {momento} en la reunión del {fecha}. ¡Muchas gracias!',
    part: 'Hola {saludo}, le recuerdo que tiene la asignación {parte} en la reunión del {fecha}.{extra} ¡Muchas gracias!',
    main: ' Su ayudante es {companero}.',
    helper: ' Usted es ayudante {de_companero}.',
    conductor: ' El lector es {companero}.',
    reader: ' Usted es el lector; el conductor es {companero}.',
  };

  // ---------- PDF text -> lines ----------

  // pages: [{ width, items: [{ str, x, y }] }] -> [{ left, label, right }]
  function toLines(pages) {
    const lines = [];
    for (const page of pages) {
      const items = page.items.filter(it => it.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const row = rows.find(r => Math.abs(r.y - it.y) < 5);
        if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        const cols = { left: [], label: [], right: [] };
        for (const it of row.items.sort((a, b) => a.x - b.x)) {
          const f = it.x / page.width;
          (f < 0.5 ? cols.left : f < 0.59 ? cols.label : cols.right).push(it.str.trim());
        }
        lines.push({ left: cols.left.join(' '), label: cols.label.join(' '), right: cols.right.join(' ') });
      }
    }
    return lines;
  }

  // ---------- lines -> weeks ----------

  function parseWeeks(lines) {
    const weeks = [];
    let week = null;
    let section = '';
    let prayers = 0;
    for (const { left, label, right } of lines) {
      const head = left.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})\s*\|\s*(.*)$/);
      if (head) {
        const month = MONTHS.indexOf(head[1].toLowerCase());
        week = {
          date: new Date(+head[3], month, +head[2], 12),
          reading: head[4],
          assignments: [],
        };
        weeks.push(week);
        section = '';
        prayers = 0;
      }
      if (!week) continue;
      if (!right && !label && /^[^a-z]+$/.test(left) && /[A-Z]{3}/.test(left)) section = left;
      if (!right) continue;
      const names = right.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
      if (/^chairman$/i.test(label)) {
        week.assignments.push({ kind: 'chairman', names });
      } else if (/^prayer$/i.test(label)) {
        week.assignments.push({ kind: 'prayer', which: prayers++ === 0 ? 'opening' : 'closing', names });
      } else {
        const part = left.match(/^(\d+)\.\s*(.+?)\s*(?:\((\d+)\s*mins?\.?\))?$/);
        if (part) {
          week.assignments.push({
            kind: 'part', num: +part[1], title: part[2].replace(/^[“"«]|[”"»]$/g, ''),
            minutes: part[3] ? +part[3] : null, section, names,
          });
        }
      }
    }
    return weeks;
  }

  // One reminder per person per assignment.
  function toReminders(week) {
    const out = [];
    for (const a of week.assignments) {
      a.names.forEach((name, i) => {
        let role = null;
        if (a.kind === 'part' && a.names.length > 1) {
          const ministry = /MINISTRY|MINISTERIO|MAESTROS/i.test(a.section);
          role = ministry ? (i === 0 ? 'main' : 'helper') : (i === 0 ? 'conductor' : 'reader');
        }
        const partner = a.names.length > 1 ? a.names[i === 0 ? 1 : 0] : null;
        out.push({ id: `${a.kind}-${a.num || a.which || ''}-${i}`, name, partner, role, assignment: a });
      });
    }
    return out;
  }

  // ---------- contacts ----------

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift().map(h => h.trim().toLowerCase());
    return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
  }

  // Keep only what the app needs.
  function toContacts(records) {
    return records.map(r => ({
      lastname: r.lastname, firstname: r.firstname, fullname: r.fullname || `${r.lastname}, ${r.firstname}`,
      descriptor: r.descriptor || '', sex: r.sex || '', phone: normalizePhone(r.cellphone),
    }));
  }

  function normalizePhone(s) {
    const d = (s || '').replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return null;
  }

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9, ]/g, ' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  // Every PDF token (after the first name) must be a prefix of the contact's matching token: "E." ~ "Elizabeth".
  function firstNamesFit(pdfFirst, contact) {
    const p = pdfFirst.replace(/,/g, '').split(' ').filter(Boolean);
    const c = norm(contact.fullname.split(',').slice(1).join(' ') || contact.firstname).split(' ');
    return p.length > 0 && p[0] === c[0] && p.slice(1).every((t, i) => (c[i + 1] || '').startsWith(t));
  }

  function matchContact(pdfName, contacts, aliases) {
    if (aliases && aliases[pdfName]) {
      const a = contacts.find(c => c.fullname === aliases[pdfName]);
      if (a) return a;
    }
    const n = norm(pdfName);
    const unique = list => (list.length === 1 ? list[0] : null);
    const byDescriptor = contacts.filter(c => c.descriptor && norm(c.descriptor) === n);
    if (byDescriptor.length) return unique(byDescriptor);
    const exact = contacts.filter(c => norm(c.fullname) === n);
    if (exact.length) return unique(exact);
    let last, first;
    if (n.includes(',')) [last, first] = n.split(/, (.*)/);
    else { const t = n.split(' '); last = t.pop(); first = t.join(' '); }
    return unique(contacts.filter(c => norm(c.lastname) === last && firstNamesFit(first || '', c)));
  }

  // ---------- messages ----------

  function formatDate(date) {
    return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' })
      .format(date).replace(',', '');
  }

  const title = c => (c.sex === 'Female' ? 'Hna.' : 'Hno.') + ' ' + c.lastname;

  function buildMessage(rem, week, person, partner, templates) {
    const t = { ...DEFAULT_TEMPLATES, ...templates };
    const a = rem.assignment;
    const companero = partner ? (partner.sex === 'Female' ? 'la ' : 'el ') + title(partner) : rem.partner;
    const deCompanero = partner ? (partner.sex === 'Female' ? 'de la ' : 'del ') + title(partner) : 'de ' + rem.partner;
    const vars = {
      saludo: person ? title(person) : rem.name,
      fecha: formatDate(week.date),
      momento: a.which === 'closing' ? 'conclusión' : 'apertura',
      parte: a.title ? `“${a.title}”${a.minutes ? ` (${a.minutes} mins.)` : ''}` : '',
      companero, de_companero: deCompanero,
    };
    const fill = s => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    vars.extra = rem.role ? fill(t[rem.role]) : '';
    return fill(t[a.kind]);
  }

  // Apple Messages wants sms:<number>&body=…; Android wants sms:<number>?body=…
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const smsLink = (phone, body) => `sms:${phone}${isAndroid ? '?' : '&'}body=${encodeURIComponent(body)}`;
  // wa.me wants the number as digits only, country code included (phones are stored as +1XXXXXXXXXX).
  const whatsappLink = (phone, body) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`;

  const api = {
    DEFAULT_TEMPLATES, toLines, parseWeeks, toReminders, parseCSV, toContacts,
    normalizePhone, matchContact, buildMessage, formatDate, smsLink, whatsappLink,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
