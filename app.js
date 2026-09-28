// UI: load contacts + PDF, list one reminder per person with a Messages link.
(function () {
  const $ = id => document.getElementById(id);
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('ar:' + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('ar:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  let contacts = store.get('contacts', null);
  let weeks = [];
  const edits = new Map(); // message text edited by hand, per week+row, until the next PDF

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  // ---------- contacts ----------

  function showContactStatus() {
    $('contactStatus').textContent = contacts
      ? `${contacts.list.length} contacts · imported ${new Date(contacts.importedAt).toLocaleDateString()}`
      : 'No contacts yet. Import your Hourglass contact list (CSV).';
  }

  $('csv').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const list = AR.toContacts(AR.parseCSV(await file.text()));
    if (!list.length || !list[0].fullname) { alert('That file does not look like the Hourglass contact list.'); return; }
    contacts = { importedAt: Date.now(), list };
    store.set('contacts', contacts);
    e.target.value = '';
    showContactStatus();
    render();
  });

  // ---------- PDF ----------

  async function loadPdf(file) {
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, isEvalSupported: false,
    }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const text = await page.getTextContent();
      pages.push({
        width: page.getViewport({ scale: 1 }).width,
        items: text.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] })),
      });
    }
    weeks = AR.parseWeeks(AR.toLines(pages));
    edits.clear();
    if (!weeks.length) { alert('No midweek meeting found in that PDF.'); return; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const next = weeks.findIndex(w => w.date >= today);
    $('week').replaceChildren(...weeks.map((w, i) =>
      new Option(`${AR.formatDate(w.date)} · ${w.reading}`, i)));
    $('week').value = next === -1 ? weeks.length - 1 : next;
    $('weekBar').hidden = weeks.length === 0;
    render();
  }

  $('pdf').addEventListener('change', e => { if (e.target.files[0]) loadPdf(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (file) loadPdf(file);
  });
  $('week').addEventListener('change', render);

  // ---------- list ----------

  const weekKey = w => w.date.toISOString().slice(0, 10);

  function roleLabel(rem) {
    const a = rem.assignment;
    if (a.kind === 'chairman') return 'Chairman';
    if (a.kind === 'prayer') return a.which === 'closing' ? 'Closing prayer' : 'Opening prayer';
    const extra = { helper: ' · helper', reader: ' · reader', conductor: ' · conductor' }[rem.role] || '';
    return `Part ${a.num}${extra}`;
  }

  function el(tag, props, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(c => c != null));
    return node;
  }

  function render() {
    const week = weeks[$('week').value];
    const list = $('list');
    if (!week) { list.replaceChildren(); return; }
    const people = contacts ? contacts.list : [];
    const aliases = store.get('aliases', {});
    const templates = store.get('templates', {});
    const sentAll = store.get('sent', {});
    const sent = sentAll[weekKey(week)] || {};
    const rems = AR.toReminders(week);
    let ready = 0;

    list.replaceChildren(...rems.map(rem => {
      const person = AR.matchContact(rem.name, people, aliases);
      const partner = rem.partner ? AR.matchContact(rem.partner, people, aliases) : null;
      const key = weekKey(week) + ':' + rem.id;
      const text = edits.get(key) ?? AR.buildMessage(rem, week, person, partner, templates);
      const phone = person && person.phone;
      if (phone) ready++;

      const row = el('div', { className: 'row' + (phone ? '' : ' nophone') + (sent[rem.id] ? ' sent' : '') });
      const actions = el('div', { className: 'actions' });
      const head = el('div', { className: 'head' },
        el('span', { className: 'role', textContent: roleLabel(rem) }),
        el('span', { className: 'name', textContent: person ? person.fullname : rem.name }),
        actions);

      if (!person) {
        const pick = el('select', {}, new Option(`“${rem.name}” not found. Pick a contact…`, ''),
          ...[...people].sort((a, b) => a.fullname.localeCompare(b.fullname)).map(c => new Option(c.fullname, c.fullname)));
        pick.addEventListener('change', () => {
          if (!pick.value) return;
          store.set('aliases', { ...store.get('aliases', {}), [rem.name]: pick.value });
          edits.delete(key);
          render();
        });
        actions.append(pick);
      } else if (!phone) {
        actions.append(el('span', { className: 'flag', textContent: 'No phone in Hourglass' }));
      } else {
        const link = el('a', { className: 'send', href: AR.smsLink(phone, text), textContent: 'Send' });
        link.addEventListener('click', () => {
          const all = store.get('sent', {});
          all[weekKey(week)] = { ...(all[weekKey(week)] || {}), [rem.id]: true };
          store.set('sent', all);
          row.classList.add('sent');
          if (!actions.querySelector('.check')) actions.prepend(el('span', { className: 'check', textContent: '✓' }));
        });
        if (sent[rem.id]) actions.append(el('span', { className: 'check', textContent: '✓' }));
        actions.append(el('span', { className: 'muted', textContent: phone }), link);
        row.link = link;
      }

      const area = el('textarea', { rows: 3, value: text });
      area.addEventListener('input', () => {
        edits.set(key, area.value);
        if (row.link) row.link.href = AR.smsLink(phone, area.value);
      });
      row.append(head, area);
      return row;
    }));

    const sentCount = rems.filter(r => sent[r.id]).length;
    $('summary').textContent = `${rems.length} people · ${ready} with phone · ${sentCount} sent`;
  }

  $('resetSent').addEventListener('click', () => {
    const week = weeks[$('week').value];
    const all = store.get('sent', {});
    delete all[weekKey(week)];
    store.set('sent', all);
    render();
  });

  // ---------- templates ----------

  function renderTemplates() {
    const saved = store.get('templates', {});
    const labels = { chairman: 'Chairman', prayer: 'Prayer', part: 'Part', main: 'Extra: has helper',
      helper: 'Extra: is helper', conductor: 'Extra: conductor', reader: 'Extra: reader' };
    $('templates').replaceChildren(...Object.keys(AR.DEFAULT_TEMPLATES).flatMap(k => {
      const area = el('textarea', { rows: 2, value: saved[k] ?? AR.DEFAULT_TEMPLATES[k] });
      area.addEventListener('change', () => {
        const t = store.get('templates', {});
        if (area.value === AR.DEFAULT_TEMPLATES[k]) delete t[k]; else t[k] = area.value;
        store.set('templates', t);
        edits.clear();
        render();
      });
      return [el('h3', { textContent: labels[k] }), area];
    }));
  }

  $('resetTemplates').addEventListener('click', () => { store.set('templates', {}); edits.clear(); renderTemplates(); render(); });
  $('resetAliases').addEventListener('click', () => { store.set('aliases', {}); render(); });

  showContactStatus();
  renderTemplates();
})();
