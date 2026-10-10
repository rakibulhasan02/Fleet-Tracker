document.documentElement.dataset.theme = localStorage.getItem('theme') || 'light';
const API_URL = '/api';

// Toggle Login / Register Views
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
if (showRegister && showLogin) {
  showRegister.onclick = () => {
    document.getElementById('loginCard').classList.add('hidden');
    document.getElementById('registerCard').classList.remove('hidden');
  };
  showLogin.onclick = () => {
    document.getElementById('registerCard').classList.add('hidden');
    document.getElementById('loginCard').classList.remove('hidden');
  };
}

// Authentication Handlers
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = 'dashboard.html';
    } else {
      alert(data.error || 'Login failed');
    }
  };
}

const regRole = document.getElementById('regRole');
if (regRole) {
  regRole.onchange = () => {
    document.getElementById('adminCodeGroup').classList.toggle('hidden', regRole.value !== 'Admin');
  };
}
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
                role: document.getElementById('regRole').value,
        adminCode: document.getElementById('regAdminCode').value
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.status === 'Pending' ? 'Registration submitted! An Admin must approve your account before you can log in.' : 'Account created! You can now log in.');
      location.reload();
    } else {
      alert(data.error || 'Registration failed');
    }
  };
}

// Dashboard Page Logic
if (window.location.pathname.includes('dashboard.html')) initDashboard();

function initDashboard() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!token) { window.location.href = 'index.html'; return; }

  const role = user.role;
  const isAdmin = role === 'Admin', isOwner = role === 'Owner', isDriver = role === 'Driver', isMechanic = role === 'Mechanic';
  const $ = (id) => document.getElementById(id);
  let vehicles = [], trips = [], incidents = [], maintenanceRecords = [];
  let options = { drivers: [], owners: [], mechanics: [] };
  let lastStats = null;

  // ---------- theme ----------
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('theme', t);
    $('themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
    if (lastStats) renderCharts(lastStats);
  };
  applyTheme(localStorage.getItem('theme') || 'light');
  $('themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // ---------- toast ----------
  function toast(msg, type = 'success') {
    let box = $('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  $('userInfo').innerText = `${user.name} (${user.role})`;

  // ---------- role permissions ----------
  const CAN = {
    stats: ['Admin', 'Owner'],
    summary: ['Driver', 'Mechanic'],
    costs: ['Admin', 'Owner', 'Mechanic'],
    manageVehicles: ['Admin', 'Owner'],
    documents: ['Admin', 'Owner', 'Driver'],
    manageDocs: ['Admin', 'Owner'],
    trips: ['Admin', 'Owner', 'Driver'],
    handleProblems: ['Admin', 'Mechanic'],
    repairs: ['Admin', 'Mechanic'],
    logMaintenance: ['Admin', 'Mechanic'],
    fuel: ['Admin', 'Owner', 'Driver'],
    reports: ['Admin', 'Owner'],
    activity: ['Admin'],
    directory: ['Admin'],
    users: ['Admin']
  };
  const can = (key) => CAN[key].includes(role);

  // Anything marked data-roles="A,B" (tabs, forms, columns) is hidden for other roles
  document.querySelectorAll('[data-roles]').forEach(el => {
    if (!el.dataset.roles.split(',').includes(role)) el.classList.add('hidden');
  });

  const ROLE_INFO = {
    Admin: ['Admin console', 'Approve registrations, manage users and every vehicle, monitor fleet activity and generate reports.'],
    Owner: ['Owner dashboard', 'Add your vehicles, assign drivers, track status and location, and review fuel, maintenance and fleet reports.'],
    Driver: ['Driver dashboard', 'See your vehicle and trips, start and complete trips, submit fuel records and report accidents or problems.'],
    Mechanic: ['Mechanic workshop', 'Work through vehicles needing repair, diagnose reported problems, record repairs and parts, and mark vehicles Ready.']
  };
  $('roleBanner').innerHTML = `<h3>Welcome, ${esc(user.name)} — ${ROLE_INFO[role]?.[0] || role}</h3><p>${ROLE_INFO[role]?.[1] || ''}</p>`;

  const TAB_LABELS = {
    Owner: { vehicles: 'My Vehicles', problems: 'Problems' },
    Driver: { vehicles: 'My Vehicle', trips: 'My Trips', problems: 'Report Problem', maintenance: 'Service History' },
    Mechanic: { vehicles: 'Vehicles', problems: 'Vehicle Problems', maintenance: 'Repairs' }
  };
  Object.entries(TAB_LABELS[role] || {}).forEach(([tab, label]) => {
    const b = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (b) b.textContent = label;
  });
  if (isDriver) {
    $('vehiclesHeading').textContent = 'My Assigned Vehicle';
    $('tripHeading').textContent = 'My Trips';
    $('tripFormTitle').textContent = 'Start a New Trip';
    $('tripSubmit').textContent = 'Add Trip';
    $('tripNote').classList.remove('hidden');
    $('problemHeading').textContent = 'My Problem Reports';
  }
  if (isMechanic) { $('maintenanceHeading').textContent = 'My Repair History'; $('problemHeading').textContent = 'Problems to Check'; }
  if (isOwner) $('vehiclesHeading').textContent = 'My Fleet';
  $('logoutBtn').onclick = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = 'index.html'; };

  // ---------- helpers ----------
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toISOString().slice(0, 10);
  const badge = (text, color) => `<span class="badge badge-${color}">${esc(text)}</span>`;
  const ago = (d) => {
    const m = Math.round((Date.now() - new Date(d)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const short = (s, n = 70) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const vehicleColor = { 'Active': 'green', 'Needs Repair': 'orange', 'In Maintenance': 'amber', 'Out of Service': 'red' };
  const vehicleLabel = (s) => (s === 'Active' ? 'Active (Ready)' : s);
  const docColor = { 'Valid': 'green', 'Expiring Soon': 'amber', 'Expired': 'red' };
  const tripColor = { 'Assigned': 'blue', 'In Progress': 'green', 'Delayed': 'amber', 'Completed': 'gray', 'Cancelled': 'red' };
  const sevColor = { Low: 'green', Medium: 'amber', High: 'red' };
  const incColor = { 'Reported': 'orange', 'Diagnosed': 'amber', 'In Repair': 'blue', 'Resolved': 'green' };
  const userColor = { Approved: 'green', Pending: 'amber', Rejected: 'red' };

  async function api(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = 'index.html'; throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const okMsg = { POST: 'Saved successfully', PUT: 'Changes saved', DELETE: 'Deleted' };
  const send = async (method, path, body) => {
    const data = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    toast(okMsg[method] || 'Done');
    return data;
  };
  const run = async (fn) => { try { await fn(); } catch (e) { if (e.message !== 'Session expired') toast(e.message, 'error'); } };
  const refreshHome = () => (can('stats') ? loadStats() : loadSummary());

  // ---------- tabs ----------
  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('section[id^="tab-"]').forEach(sec => sec.classList.toggle('hidden', sec.id !== `tab-${name}`));
  }
  document.querySelectorAll('.tab').forEach(btn => { btn.onclick = () => activateTab(btn.dataset.tab); });
  activateTab(isMechanic ? 'repairs' : isDriver ? 'trips' : 'vehicles');

  // ---------- generic modal form ----------
  const partsEditorHtml = () => `<div class="span-2 parts-editor"><label class="field-label">Replaced parts</label><div class="parts-box"></div>
    <div class="parts-foot"><button type="button" class="btn btn-secondary btn-sm" data-add-part>+ Add part</button><strong class="total-preview"></strong></div></div>`;

  function getParts(root) {
    return [...root.querySelectorAll('.part-row')].map(r => ({
      name: r.querySelector('[data-p=name]').value.trim(),
      quantity: Number(r.querySelector('[data-p=quantity]').value) || 1,
      unitCost: Number(r.querySelector('[data-p=unitCost]').value) || 0
    })).filter(p => p.name);
  }
  function initPartsEditor(root) {
    const box = root.querySelector('.parts-box');
    const labor = root.querySelector('[name=laborCost]');
    const total = () => {
      const sum = getParts(root).reduce((s, p) => s + p.quantity * p.unitCost, 0);
      root.querySelector('.total-preview').textContent = `Total: ${money((Number(labor?.value) || 0) + sum)}`;
    };
    const add = (p = {}) => {
      const row = document.createElement('div');
      row.className = 'part-row';
      row.innerHTML = `<input data-p="name" placeholder="Part name" value="${esc(p.name || '')}">
        <input data-p="quantity" type="number" min="1" placeholder="Qty" value="${esc(p.quantity || 1)}">
        <input data-p="unitCost" type="number" min="0" step="0.01" placeholder="Unit cost" value="${p.unitCost != null ? esc(p.unitCost) : ''}">
        <button type="button" class="btn btn-danger" data-remove-part title="Remove">✕</button>`;
      box.appendChild(row);
    };
    root.querySelector('[data-add-part]').onclick = () => { add(); total(); };
    box.oninput = total;
    box.onclick = (e) => { const b = e.target.closest('[data-remove-part]'); if (b) { b.closest('.part-row').remove(); total(); } };
    if (labor) labor.addEventListener('input', total);
    root.setParts = (parts) => { box.innerHTML = ''; (parts || []).forEach(add); total(); };
    total();
  }

  const closeForm = () => $('formModal').classList.add('hidden');
  $('formModal').onclick = (e) => { if (e.target === $('formModal')) closeForm(); };

  // fields: {key,label,type: text|number|date|select|textarea|parts, value, options, required, min, step, emptyAs}
  function openForm({ title, fields, submitLabel = 'Save', onSubmit }) {
    const form = $('fmForm');
    $('fmTitle').textContent = title;
    form.innerHTML = fields.map(f => {
      if (f.type === 'parts') return partsEditorHtml();
      const v = f.value ?? '';
      let input;
      if (f.type === 'select') input = `<select name="${f.key}">${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      else if (f.type === 'textarea') input = `<textarea name="${f.key}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
      else input = `<input name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
      return `<div class="span-2 field"><label>${esc(f.label)}</label>${input}</div>`;
    }).join('') + `<button type="submit" class="btn">${esc(submitLabel)}</button><button type="button" class="btn btn-secondary" id="fmCancel">Cancel</button>`;
    if (fields.some(f => f.type === 'parts')) {
      initPartsEditor(form);
      form.setParts(fields.find(f => f.type === 'parts').value);
    }
    $('fmCancel').onclick = closeForm;
    form.onsubmit = (e) => {
      e.preventDefault();
      const body = {};
      fields.forEach(f => {
        if (f.type === 'parts') { body.parts = getParts(form); return; }
        let val = form.elements[f.key].value;
        if (f.type === 'number') val = val === '' ? f.emptyAs : Number(val);
        body[f.key] = val;
      });
      run(async () => { await onSubmit(body); closeForm(); });
    };
    $('formModal').classList.remove('hidden');
  }

  // ---------- charts ----------
  const charts = {};
  function renderCharts(s) {
    if (typeof Chart === 'undefined' || !can('stats')) return;
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
    Object.values(charts).forEach(c => c.destroy());

    charts.status = new Chart($('statusChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(s.byStatus),
        datasets: [{ data: Object.values(s.byStatus), backgroundColor: ['#22c55e', '#f97316', '#f59e0b', '#ef4444'], borderWidth: 0 }]
      },
      options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
    });

    charts.cost = new Chart($('costChart'), {
      type: 'bar',
      data: {
        labels: s.monthly.map(m => m.label),
        datasets: [
          { label: 'Maintenance', data: s.monthly.map(m => m.maintenance), backgroundColor: '#6366f1', borderRadius: 6 },
          { label: 'Fuel', data: s.monthly.map(m => m.fuel), backgroundColor: '#06b6d4', borderRadius: 6 }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } }
      }
    });
  }

  const tiles = (list) => list.map(([c, icon, v, l]) => `
      <div class="stat ${c}">
        <div class="icon">${icon}</div>
        <div><div class="value">${esc(v)}</div><div class="label">${esc(l)}</div></div>
      </div>`).join('');

  async function loadStats() {
    if (!can('stats')) return;
    const s = await api('/stats');
    lastStats = s;
    const attention = s.documents.expired + s.documents.expiringSoon;
    $('statsGrid').innerHTML = tiles([
      ['', '🚗', s.totalVehicles, 'Total vehicles'],
      ['green', '✅', s.byStatus['Active'], 'Active (ready)'],
      ['orange', '🚨', s.byStatus['Needs Repair'], 'Needs repair'],
      ['amber', '🔧', s.byStatus['In Maintenance'], 'In maintenance'],
      ['red', '⛔', s.byStatus['Out of Service'], 'Out of service'],
      ['blue', '🛣️', s.trips.active, `Trips on the road (${s.trips.planned} planned)`],
      [s.openProblems ? 'orange' : 'green', '⚠️', s.openProblems, 'Open problem reports'],
      ['', '⛽', s.fuel.kmPerL ? `${s.fuel.kmPerL.toFixed(1)} km/L` : '—', 'Fleet fuel efficiency'],
      ['', '💰', money(s.maintenance.totalCost + s.fuel.totalCost), 'Total running cost'],
      [attention ? 'red' : 'green', '📄', attention, 'Documents needing attention'],
      ...(isAdmin ? [
        ['', '🧑‍✈️', s.people.drivers, 'Drivers'],
        ['', '🏢', s.people.owners, 'Owners'],
        ['', '🛠️', s.people.mechanics, 'Mechanics']
      ] : [])
    ]);

    const alertBox = $('docAlert');
    if (attention) {
      const parts = [];
      if (s.documents.expired) parts.push(`${s.documents.expired} expired`);
      if (s.documents.expiringSoon) parts.push(`${s.documents.expiringSoon} expiring within 30 days`);
      alertBox.textContent = `⚠️ Document alert: ${parts.join(', ')}. Check the Documents tab.`;
      alertBox.classList.toggle('danger', s.documents.expired > 0);
      alertBox.classList.remove('hidden');
    } else {
      alertBox.classList.add('hidden');
    }
    renderCharts(s);
  }

  async function loadSummary() {
    if (!can('summary')) return;
    const s = await api('/summary');
    $('statsGrid').innerHTML = isDriver ? tiles([
      ['', '🚗', s.vehicles, 'Assigned vehicles'],
      ['green', '🛣️', s.activeTrips, 'Trips in progress'],
      ['blue', '📋', s.plannedTrips, 'Upcoming trips'],
      [s.openReports ? 'orange' : 'green', '⚠️', s.openReports, 'My open problem reports'],
      ['', '⛽', `${s.fuelLiters.toFixed(1)} L`, 'Fuel logged this month']
    ]) : tiles([
      [s.needsRepair ? 'orange' : 'green', '🚨', s.needsRepair, 'Need repair'],
      ['amber', '🔧', s.inMaintenance, 'Under maintenance'],
      [s.openProblems ? 'orange' : 'green', '⚠️', s.openProblems, 'Open problem reports'],
      ['', '✅', s.jobsThisMonth, 'My jobs this month'],
      ['', '💰', money(s.costThisMonth), 'My repair costs this month']
    ]);
  }

  // ---------- vehicles ----------
  function filteredVehicles() {
    const q = $('vehicleSearch').value.trim().toLowerCase();
    const status = $('vehicleFilter').value;
    return vehicles.filter(v =>
      (!status || v.status === status) &&
      (!q || [v.name, v.plateNumber, v.model, v.assignedDriver, v.owner].some(x => String(x || '').toLowerCase().includes(q)))
    );
  }

  const locationCell = (v) => {
    const l = v.location;
    if (!l || l.lat == null) return '<small class="muted">No location yet</small>';
    const lat = Number(l.lat), lng = Number(l.lng);
    return `<a class="loc-link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}">📍 View map</a> <small class="muted">${ago(l.updatedAt)}</small>`;
  };

  function renderVehicles() {
    const rows = filteredVehicles();
    const manage = can('manageVehicles');
    $('vehicleTableBody').innerHTML = rows.length ? rows.map(v => `
      <tr>
        <td>${esc(v.name)}</td>
        <td><span class="plate">${esc(v.plateNumber)}</span></td>
        <td>${esc(v.model)}</td>
        <td>${Number(v.mileage).toLocaleString()} km</td>
        <td>${badge(vehicleLabel(v.status), vehicleColor[v.status] || 'green')}</td>
        <td>${esc(v.assignedDriver)}</td>
        <td>${esc(v.owner)}</td>
        <td>${locationCell(v)}</td>
        ${manage ? `<td class="actions">
          <button class="btn btn-edit" data-action="edit" data-id="${esc(v._id)}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${esc(v._id)}">Delete</button>
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="9" class="empty">${isDriver ? 'No vehicle has been assigned to you yet.' : 'No vehicles found.'}</td></tr>`;
  }

  function fillPlateSelects() {
    const list = (items) => items.length
      ? items.map(v => `<option value="${esc(v.plateNumber)}">${esc(v.plateNumber)} - ${esc(v.name)}</option>`).join('')
      : '<option value="">No vehicle available</option>';
    ['dPlate', 'mPlate', 'fPlate', 'iPlate'].forEach(id => { $(id).innerHTML = list(vehicles); });
    $('tPlate').innerHTML = list(vehicles.filter(v => v.status === 'Active')); // trips only on ready vehicles
    fillIncidentSelect();
  }

  function fillPersonSelects() {
    const opts = (items, first) => `<option value="">${first}</option>` + items.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    ['vDriver', 'eDriver'].forEach(id => { $(id).innerHTML = opts(options.drivers, 'Unassigned driver'); });
    ['vOwner', 'eOwner'].forEach(id => { $(id).innerHTML = opts(options.owners, 'Unassigned owner'); });
    $('tDriver').innerHTML = opts(options.drivers, "Vehicle's assigned driver");
    $('mMechanic').innerHTML = `<option value="">— No mechanic —</option>` + options.mechanics.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  }

  async function loadOptions() {
    if (!(isAdmin || isOwner)) return;
    options = await api('/people');
    fillPersonSelects();
  }

  async function loadVehicles() {
    vehicles = await api('/vehicles');
    renderVehicles();
    fillPlateSelects();
    renderRepairs();
    if (isAdmin) { renderPeople('drivers'); renderPeople('owners'); }
  }

  $('vehicleSearch').oninput = renderVehicles;
  $('vehicleFilter').onchange = renderVehicles;

  $('vehicleForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        name: $('vName').value,
        plateNumber: $('vPlate').value,
        model: $('vModel').value,
        mileage: Number($('vMileage').value),
        status: $('vStatus').value,
        driverId: $('vDriver').value
      };
      if (isAdmin) body.ownerId = $('vOwner').value;
      await send('POST', '/vehicles', body);
      e.target.reset();
      await Promise.all([loadVehicles(), refreshHome()]);
    });
  };

  $('vehicleTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const v = vehicles.find(x => x._id === btn.dataset.id);
    if (btn.dataset.action === 'edit' && v) openEdit(v);
    if (btn.dataset.action === 'delete') run(async () => {
      if (!confirm('Are you sure you want to remove this vehicle?')) return;
      await send('DELETE', `/vehicles/${btn.dataset.id}`);
      await Promise.all([loadVehicles(), refreshHome()]);
    });
  };

  // edit modal
  function setPerson(id, list, name) {
    const el = $(id);
    const hit = list.find(p => p.name === name);
    if (hit) el.value = hit.id;
    else if (name && name !== 'Unassigned') { el.add(new Option(`${name} (no account)`, '__legacy')); el.value = '__legacy'; }
    else el.value = '';
  }
  function openEdit(v) {
    fillPersonSelects();
    $('eId').value = v._id;
    $('eName').value = v.name;
    $('ePlate').value = v.plateNumber;
    $('eModel').value = v.model;
    $('eMileage').value = v.mileage;
    $('eStatus').value = v.status;
    setPerson('eDriver', options.drivers, v.assignedDriver);
    if (isAdmin) setPerson('eOwner', options.owners, v.owner);
    $('editModal').classList.remove('hidden');
  }
  const closeEdit = () => $('editModal').classList.add('hidden');
  $('editCancel').onclick = closeEdit;
  $('editModal').onclick = (e) => { if (e.target === $('editModal')) closeEdit(); };
  $('editForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        name: $('eName').value,
        plateNumber: $('ePlate').value,
        model: $('eModel').value,
        mileage: Number($('eMileage').value),
        status: $('eStatus').value
      };
      if ($('eDriver').value !== '__legacy') body.driverId = $('eDriver').value;
      if (isAdmin && $('eOwner').value !== '__legacy') body.ownerId = $('eOwner').value;
      await send('PUT', `/vehicles/${$('eId').value}`, body);
      closeEdit();
      await Promise.all([loadVehicles(), refreshHome()]);
    });
  };

  // CSV helper + vehicle export
  const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  function downloadCsv(rows, name) {
    const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name}-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('exportBtn').onclick = () => downloadCsv(
    [['Name', 'Plate Number', 'Model', 'Mileage (km)', 'Status', 'Driver', 'Owner']]
      .concat(filteredVehicles().map(v => [v.name, v.plateNumber, v.model, v.mileage, v.status, v.assignedDriver, v.owner])),
    'fleet');

  // ---------- repair queue (mechanic) ----------
  const openProblemsFor = (plate) => incidents.filter(i => i.vehiclePlate === plate && i.status !== 'Resolved');

  function renderRepairs() {
    if (!can('repairs')) return;
    const queue = vehicles.filter(v => ['Needs Repair', 'In Maintenance'].includes(v.status))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Needs Repair' ? -1 : 1));
    $('repairSummary').textContent = `${vehicles.filter(v => v.status === 'Needs Repair').length} need repair · ${vehicles.filter(v => v.status === 'In Maintenance').length} under maintenance`;
    $('repairTableBody').innerHTML = queue.length ? queue.map(v => {
      const probs = openProblemsFor(v.plateNumber);
      return `<tr>
        <td><span class="plate">${esc(v.plateNumber)}</span><br><small class="muted">${esc(v.name)}</small></td>
        <td>${badge(vehicleLabel(v.status), vehicleColor[v.status])}</td>
        <td>${Number(v.mileage).toLocaleString()} km</td>
        <td>${esc(v.assignedDriver)}</td>
        <td>${probs.length ? probs.map(p => `${badge(p.severity, sevColor[p.severity])} ${esc(p.type)}: ${esc(short(p.description, 60))}`).join('<br>') : '<small class="muted">No report — direct service</small>'}</td>
        <td class="actions">
          ${v.status === 'Needs Repair' ? `<button class="btn btn-edit" data-act="start" data-id="${esc(v._id)}">Start maintenance</button>` : ''}
          <button class="btn btn-ok" data-act="ready" data-id="${esc(v._id)}">Mark Ready</button>
          <button class="btn" style="width:auto;padding:.35rem .8rem;font-size:.85rem" data-act="log" data-plate="${esc(v.plateNumber)}">Record repair</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">🎉 No vehicles are waiting for repair.</td></tr>`;
  }

  $('repairTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'log') {
      activateTab('maintenance');
      $('mPlate').value = btn.dataset.plate;
      fillIncidentSelect();
      $('mLabor').focus();
      return;
    }
    run(async () => {
      await send('PUT', `/vehicles/${btn.dataset.id}/status`, { status: btn.dataset.act === 'ready' ? 'Active' : 'In Maintenance' });
      await Promise.all([loadVehicles(), refreshHome()]);
    });
  };

  // ---------- trips ----------
  const LIVE = ['In Progress', 'Delayed'];
  const getPos = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 5000, maximumAge: 60000 });
  });

  let locTimer = null;
  function syncLocationSharing() {
    const active = isDriver && trips.some(t => LIVE.includes(t.status));
    if (!active) { if (locTimer) { clearInterval(locTimer); locTimer = null; } return; }
    if (locTimer) return;
    const push = async () => {
      const cur = trips.find(t => LIVE.includes(t.status));
      const p = cur && await getPos();
      if (p) api(`/trips/${cur._id}/location`, { method: 'PUT', body: JSON.stringify(p) }).catch(() => {});
    };
    push();
    locTimer = setInterval(push, 60000);
  }

  function renderTrips() {
    const f = $('tripFilter').value;
    const rows = trips.filter(t => !f || t.status === f);
    $('tripTableBody').innerHTML = rows.length ? rows.map(t => {
      const btns = [];
      if (isAdmin || isDriver) {
        if (t.status === 'Assigned') btns.push(['start', 'Start', 'btn-ok']);
        if (LIVE.includes(t.status)) btns.push(['complete', 'Complete', 'btn-ok']);
        if (t.status === 'In Progress') btns.push(['delay', 'Delay', 'btn-edit']);
        if (t.status === 'Delayed') btns.push(['resume', 'Resume', 'btn-edit']);
      }
      if (!['Completed', 'Cancelled'].includes(t.status)) btns.push(['cancel', 'Cancel', 'btn-danger']);
      if (isAdmin) btns.push(['delete', 'Delete', 'btn-danger']);
      return `<tr>
        <td><span class="plate">${esc(t.vehiclePlate)}</span></td>
        <td>${esc(t.driverName)}</td>
        <td>${esc(t.origin)} → ${esc(t.destination)}${t.purpose ? `<br><small class="muted">${esc(t.purpose)}</small>` : ''}</td>
        <td>${badge(t.status, tripColor[t.status])}</td>
        <td>${t.startedAt ? fmtTime(t.startedAt) : '-'}</td>
        <td>${t.completedAt ? fmtTime(t.completedAt) : '-'}</td>
        <td>${t.distance != null ? `${Number(t.distance).toLocaleString()} km` : '-'}</td>
        <td class="wrap"><small>${esc(t.notes)}</small></td>
        <td class="actions">${btns.map(([a, l, c]) => `<button class="btn ${c}" data-act="${a}" data-id="${esc(t._id)}">${l}</button>`).join('')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" class="empty">No trips found.</td></tr>`;
  }

  async function loadTrips() {
    trips = await api('/trips');
    renderTrips();
    syncLocationSharing();
  }
  $('tripFilter').onchange = renderTrips;

  $('tripForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/trips', {
        vehiclePlate: $('tPlate').value,
        driverId: isDriver ? undefined : $('tDriver').value,
        origin: $('tOrigin').value,
        destination: $('tDest').value,
        purpose: $('tPurpose').value
      });
      e.target.reset();
      await Promise.all([loadTrips(), refreshHome()]);
    });
  };

  $('tripTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const t = trips.find(x => x._id === btn.dataset.id);
    if (!t) return;
    const reload = () => Promise.all([loadTrips(), loadVehicles(), refreshHome()]);
    const act = btn.dataset.act;
    const veh = vehicles.find(v => v.plateNumber === t.vehiclePlate);

    if (act === 'start') {
      openForm({
        title: `Start trip: ${t.origin} → ${t.destination}`, submitLabel: 'Start Trip',
        fields: [{ key: 'startOdometer', label: 'Current odometer (km)', type: 'number', min: 0, value: veh ? veh.mileage : '' }],
        onSubmit: async (b) => { const p = await getPos(); await send('PUT', `/trips/${t._id}/start`, { ...b, ...(p || {}) }); await reload(); }
      });
    } else if (act === 'complete') {
      openForm({
        title: `Complete trip: ${t.origin} → ${t.destination}`, submitLabel: 'Complete Trip',
        fields: [
          { key: 'endOdometer', label: 'Final odometer (km)', type: 'number', min: t.startOdometer || 0, required: true, value: t.startOdometer ?? '' },
          { key: 'notes', label: 'Trip notes (optional)', type: 'textarea' }
        ],
        onSubmit: async (b) => { const p = await getPos(); await send('PUT', `/trips/${t._id}/complete`, { ...b, ...(p || {}) }); await reload(); }
      });
    } else if (act === 'delay' || act === 'cancel') {
      openForm({
        title: act === 'delay' ? 'Mark trip as delayed' : 'Cancel this trip', submitLabel: act === 'delay' ? 'Mark Delayed' : 'Cancel Trip',
        fields: [{ key: 'note', label: 'Reason', type: 'textarea', placeholder: 'e.g. traffic, road closed, vehicle problem' }],
        onSubmit: async (b) => { await send('PUT', `/trips/${t._id}/status`, { status: act === 'delay' ? 'Delayed' : 'Cancelled', note: b.note }); await reload(); }
      });
    } else if (act === 'resume') {
      run(async () => { await send('PUT', `/trips/${t._id}/status`, { status: 'In Progress' }); await reload(); });
    } else if (act === 'delete') {
      run(async () => {
        if (!confirm('Delete this trip?')) return;
        await send('DELETE', `/trips/${t._id}`);
        await reload();
      });
    }
  };

  // ---------- problems / accident reports ----------
  function renderIncidents() {
    const f = $('incidentFilter').value;
    const rows = incidents.filter(i => f === 'open' ? i.status !== 'Resolved' : !f || i.status === f);
    $('incidentTableBody').innerHTML = rows.length ? rows.map(i => `
      <tr>
        <td>${fmtDate(i.createdAt)}</td>
        <td><span class="plate">${esc(i.vehiclePlate)}</span></td>
        <td>${esc(i.type)}</td>
        <td>${badge(i.severity, sevColor[i.severity])}</td>
        <td>${esc(i.reportedBy)}</td>
        <td class="wrap">${esc(i.description)}</td>
        <td>${badge(i.status, incColor[i.status])}</td>
        <td class="wrap"><small>${esc(i.diagnosis) || '-'}</small></td>
        ${can('handleProblems') ? `<td class="actions">
          <button class="btn btn-edit" data-act="update" data-id="${esc(i._id)}">Check / Update</button>
          ${isAdmin ? `<button class="btn btn-danger" data-act="delete" data-id="${esc(i._id)}">Delete</button>` : ''}
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="9" class="empty">No problem reports.</td></tr>`;
  }

  async function loadIncidents() {
    incidents = await api('/incidents');
    renderIncidents();
    fillIncidentSelect();
    renderRepairs();
  }
  $('incidentFilter').onchange = renderIncidents;

  $('incidentForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/incidents', {
        vehiclePlate: $('iPlate').value, type: $('iType').value, severity: $('iSeverity').value, description: $('iDesc').value
      });
      e.target.reset();
      $('iSeverity').value = 'Medium';
      await Promise.all([loadIncidents(), loadVehicles(), refreshHome()]);
    });
  };

  $('incidentTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = incidents.find(x => x._id === btn.dataset.id);
    if (!i) return;
    const reload = () => Promise.all([loadIncidents(), loadVehicles(), refreshHome()]);
    if (btn.dataset.act === 'update') {
      openForm({
        title: `${i.type} on ${i.vehiclePlate}`,
        fields: [
          { key: 'status', label: 'Status', type: 'select', options: ['Reported', 'Diagnosed', 'In Repair', 'Resolved'], value: i.status },
          { key: 'diagnosis', label: 'Diagnosis / mechanic notes', type: 'textarea', value: i.diagnosis, placeholder: 'What is wrong and what needs to be done?' }
        ],
        onSubmit: async (b) => { await send('PUT', `/incidents/${i._id}`, b); await reload(); }
      });
    } else if (btn.dataset.act === 'delete') {
      run(async () => {
        if (!confirm('Delete this report?')) return;
        await send('DELETE', `/incidents/${i._id}`);
        await reload();
      });
    }
  };

  // ---------- documents ----------
  async function loadDocuments() {
    const docs = await api('/documents');
    const manage = can('manageDocs');
    $('documentTableBody').innerHTML = docs.length ? docs.map(d => {
      const when = d.daysLeft < 0 ? `${-d.daysLeft} days ago` : `in ${d.daysLeft} days`;
      return `<tr>
        <td>${esc(d.vehiclePlate)}</td>
        <td>${esc(d.documentType)}</td>
        <td>${esc(d.title)}</td>
        <td>${fmtDate(d.expiryDate)} <small>(${when})</small></td>
        <td>${badge(d.status, docColor[d.status])}</td>
        ${manage ? `<td><button class="btn btn-danger" data-id="${esc(d._id)}">Delete</button></td>` : ''}
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">No documents tracked yet.</td></tr>`;
  }

  $('documentForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/documents', {
        vehiclePlate: $('dPlate').value,
        documentType: $('dType').value,
        title: $('dTitle').value,
        expiryDate: $('dExpiry').value
      });
      e.target.reset();
      await Promise.all([loadDocuments(), refreshHome()]);
    });
  };

  $('documentTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (!confirm('Remove this document?')) return;
      await send('DELETE', `/documents/${btn.dataset.id}`);
      await Promise.all([loadDocuments(), refreshHome()]);
    });
  };

  // ---------- maintenance / repairs ----------
  function fillIncidentSelect() {
    const plate = $('mPlate').value;
    const open = incidents.filter(i => i.vehiclePlate === plate && i.status !== 'Resolved');
    $('mIncident').innerHTML = `<option value="">Related problem report: none</option>` +
      open.map(i => `<option value="${esc(i._id)}">${esc(i.type)} (${esc(i.severity)}): ${esc(short(i.description, 45))}</option>`).join('');
  }
  $('mPlate').onchange = fillIncidentSelect;

  async function loadMaintenance() {
    const records = await api('/maintenance');
    maintenanceRecords = records;
    if (isAdmin) renderPeople('mechanics');
    const total = records.reduce((sum, r) => sum + (r.cost || 0), 0);
    $('maintenanceTotal').textContent = records.length && can('costs') ? `Total spend: ${money(total)}` : '';
    const editable = can('logMaintenance');
    $('maintenanceTableBody').innerHTML = records.length ? records.map(r => `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td>${esc(r.vehiclePlate)}</td>
        <td>${esc(r.type)}</td>
        <td>${esc(r.mechanic) || '-'}</td>
        <td class="wrap"><small>${(r.parts || []).length ? (r.parts || []).map(p => `${esc(p.name)} ×${esc(p.quantity)}`).join('\n') : '-'}</small></td>
        <td>${r.cost == null ? '-' : money(r.cost)}</td>
        <td>${r.mileageAtService != null ? Number(r.mileageAtService).toLocaleString() + ' km' : '-'}</td>
        <td class="wrap"><small>${esc(r.notes)}</small></td>
        <td>${esc(r.loggedBy)}</td>
        ${editable ? `<td class="actions">
          <button class="btn btn-edit" data-act="edit" data-id="${esc(r._id)}">Edit costs / parts</button>
          ${isAdmin ? `<button class="btn btn-danger" data-act="delete" data-id="${esc(r._id)}">Delete</button>` : ''}
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="10" class="empty">No maintenance logged yet.</td></tr>`;
  }

  $('mDate').value = today();
  initPartsEditor($('maintenanceForm'));
  $('maintenanceForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const form = e.target;
      await send('POST', '/maintenance', {
        vehiclePlate: $('mPlate').value,
        type: $('mType').value,
        mechanic: isAdmin ? $('mMechanic').value : undefined,
        date: $('mDate').value,
        laborCost: Number($('mLabor').value || 0),
        parts: getParts(form),
        mileageAtService: $('mMileage').value ? Number($('mMileage').value) : undefined,
        notes: $('mNotes').value,
        incidentId: $('mIncident').value || undefined,
        vehicleStatusAfter: $('mAfter').value || undefined
      });
      form.reset();
      form.setParts([]);
      $('mDate').value = today();
      await Promise.all([loadMaintenance(), loadVehicles(), loadIncidents(), refreshHome()]);
    });
  };

  $('maintenanceTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const r = maintenanceRecords.find(x => x._id === btn.dataset.id);
    if (!r) return;
    const reload = () => Promise.all([loadMaintenance(), refreshHome()]);
    if (btn.dataset.act === 'delete') {
      run(async () => {
        if (!confirm('Remove this maintenance record?')) return;
        await send('DELETE', `/maintenance/${r._id}`);
        await reload();
      });
      return;
    }
    const partsSum = (r.parts || []).reduce((s, p) => s + p.quantity * p.unitCost, 0);
    openForm({
      title: `${r.type} on ${r.vehiclePlate}`,
      fields: [
        { key: 'type', label: 'Service type', type: 'select', options: ['Oil Change', 'Tire Service', 'Brake Service', 'Inspection', 'Repair', 'Other'], value: r.type },
        { key: 'laborCost', label: 'Labor / service cost', type: 'number', min: 0, step: '0.01', emptyAs: 0, value: r.laborCost ?? Math.max(0, (r.cost || 0) - partsSum) },
        { type: 'parts', value: r.parts || [] },
        { key: 'mileageAtService', label: 'Mileage at service (km)', type: 'number', min: 0, value: r.mileageAtService ?? '' },
        { key: 'notes', label: 'Notes', type: 'textarea', value: r.notes }
      ],
      onSubmit: async (b) => { await send('PUT', `/maintenance/${r._id}`, b); await reload(); }
    });
  };

  // ---------- fuel ----------
  async function loadFuel() {
    const logs = await api('/fuel');
    const liters = logs.reduce((sum, l) => sum + (l.liters || 0), 0);
    const cost = logs.reduce((sum, l) => sum + (l.cost || 0), 0);
    $('fuelTotal').textContent = logs.length ? `${liters.toFixed(1)} L · ${money(cost)}` : '';
    $('fuelTableBody').innerHTML = logs.length ? logs.map(l => `
      <tr>
        <td>${fmtDate(l.date)}</td>
        <td><span class="plate">${esc(l.vehiclePlate)}</span></td>
        <td>${Number(l.liters).toFixed(1)} L</td>
        <td>${money(l.cost)}</td>
        <td>${money(l.cost / l.liters)}</td>
        <td>${l.odometer != null ? Number(l.odometer).toLocaleString() + ' km' : '-'}</td>
        <td>${esc(l.station)}</td>
        <td>${esc(l.loggedBy)}</td>
        ${isAdmin ? `<td><button class="btn btn-danger" data-id="${esc(l._id)}">Delete</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="9" class="empty">No fuel logged yet.</td></tr>`;
  }

  $('fDate').value = today();
  $('fuelForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/fuel', {
        vehiclePlate: $('fPlate').value,
        date: $('fDate').value,
        liters: Number($('fLiters').value),
        cost: Number($('fCost').value),
        odometer: $('fOdo').value ? Number($('fOdo').value) : undefined,
        station: $('fStation').value
      });
      e.target.reset();
      $('fDate').value = today();
      await Promise.all([loadFuel(), loadVehicles(), refreshHome()]);
    });
  };

  $('fuelTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (!confirm('Remove this fuel log?')) return;
      await send('DELETE', `/fuel/${btn.dataset.id}`);
      await Promise.all([loadFuel(), refreshHome()]);
    });
  };

  // ---------- reports (Admin + Owner) ----------
  let lastReport = null;
  const perKm = (n) => (n == null ? '-' : money(n));
  async function loadReport() {
    if (!can('reports')) return;
    const r = await api(`/reports?from=${$('reportFrom').value}&to=${$('reportTo').value}`);
    lastReport = r;
    $('reportPeriod').textContent = `${isAdmin ? 'Whole fleet' : 'Your fleet'} · ${fmtDate(r.from)} to ${fmtDate(r.to)} · ${r.totals.vehicles} vehicle(s)`;
    const t = r.totals;
    $('reportTiles').innerHTML = tiles([
      ['', '💰', money(t.totalCost), 'Total cost'],
      ['', '⛽', money(t.fuelCost), `Fuel (${t.fuelLiters.toFixed(1)} L)`],
      ['', '🔧', money(t.maintenanceCost), `Maintenance (${t.maintenanceJobs} jobs)`],
      ['blue', '🛣️', `${t.km.toLocaleString()} km`, `${t.trips} completed trips`],
      [t.problems ? 'orange' : 'green', '⚠️', t.problems, 'Problems reported']
    ]);
    $('reportBody').innerHTML = r.rows.length ? r.rows.map(x => `
      <tr>
        <td><span class="plate">${esc(x.plateNumber)}</span><br><small class="muted">${esc(x.name)}</small></td>
        <td>${badge(vehicleLabel(x.status), vehicleColor[x.status] || 'green')}</td>
        <td>${x.trips}</td>
        <td>${x.km.toLocaleString()} km</td>
        <td>${x.fuelLiters.toFixed(1)}</td>
        <td>${money(x.fuelCost)}</td>
        <td>${money(x.maintenanceCost)}</td>
        <td><strong>${money(x.totalCost)}</strong></td>
        <td>${perKm(x.costPerKm)}</td>
        <td>${x.problems}</td>
      </tr>`).join('') : `<tr><td colspan="10" class="empty">No vehicles to report on.</td></tr>`;
    $('reportFoot').innerHTML = r.rows.length ? `<tr>
      <td>Total</td><td></td><td>${t.trips}</td><td>${t.km.toLocaleString()} km</td><td>${t.fuelLiters.toFixed(1)}</td>
      <td>${money(t.fuelCost)}</td><td>${money(t.maintenanceCost)}</td><td>${money(t.totalCost)}</td><td>${perKm(t.costPerKm)}</td><td>${t.problems}</td></tr>` : '';
  }
  if (can('reports')) {
    const d = new Date();
    $('reportTo').value = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 29);
    $('reportFrom').value = d.toISOString().slice(0, 10);
    $('reportRun').onclick = () => run(loadReport);
    $('reportPrint').onclick = () => window.print();
    $('reportCsv').onclick = () => {
      if (!lastReport) return toast('Generate the report first', 'error');
      downloadCsv([['Plate', 'Vehicle', 'Status', 'Trips', 'Distance (km)', 'Fuel (L)', 'Fuel cost', 'Maintenance cost', 'Total cost', 'Cost per km', 'Problems']]
        .concat(lastReport.rows.map(x => [x.plateNumber, x.name, x.status, x.trips, x.km, x.fuelLiters.toFixed(1), x.fuelCost, x.maintenanceCost, x.totalCost, x.costPerKm == null ? '' : x.costPerKm.toFixed(2), x.problems])),
        'fleet-report');
    };
  }

  // ---------- activity log (Admin) ----------
  let activity = [];
  function renderActivity() {
    const q = $('activitySearch').value.trim().toLowerCase();
    const rows = activity.filter(a => !q || [a.user, a.role, a.action, a.details].some(x => String(x || '').toLowerCase().includes(q)));
    $('activityBody').innerHTML = rows.length ? rows.map(a => `
      <tr><td>${fmtTime(a.createdAt)}</td><td>${esc(a.user)}</td><td>${esc(a.role)}</td><td>${esc(a.action)}</td><td class="wrap"><small>${esc(a.details)}</small></td></tr>`).join('')
      : `<tr><td colspan="5" class="empty">No activity yet.</td></tr>`;
  }
  async function loadActivity() { activity = await api('/activity'); renderActivity(); }
  if (isAdmin) $('activitySearch').oninput = renderActivity;

  // ---------- drivers / owners / mechanics directory (Admin) ----------
  const PEOPLE = {
    drivers: {
      title: 'Driver', plural: 'Drivers', icon: '🧑‍✈️', extraLabel: 'Vehicles',
      fields: [
        { key: 'name', label: 'Full name' },
        { key: 'phone', label: 'Phone' },
        { key: 'licenseNumber', label: 'License number' },
        { key: 'licenseExpiry', label: 'License expiry', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: ['Available', 'On Trip', 'On Leave'] }
      ]
    },
    owners: {
      title: 'Owner', plural: 'Owners', icon: '🏢', extraLabel: 'Vehicles',
      fields: [
        { key: 'name', label: 'Name / company' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email', type: 'email', optional: true },
        { key: 'address', label: 'Address', optional: true }
      ]
    },
    mechanics: {
      title: 'Mechanic', plural: 'Mechanics', icon: '🛠️', extraLabel: 'Jobs',
      fields: [
        { key: 'name', label: 'Full name' },
        { key: 'phone', label: 'Phone' },
        { key: 'specialty', label: 'Specialty', type: 'select', options: ['General', 'Engine', 'Electrical', 'Brakes', 'Tires', 'Body Work'] },
        { key: 'workshop', label: 'Workshop', optional: true },
        { key: 'hourlyRate', label: 'Hourly rate', type: 'number', optional: true }
      ]
    }
  };
  const directory = { drivers: [], owners: [], mechanics: [] };
  const editing = {};

  const extraCount = {
    drivers: (p) => vehicles.filter(v => v.assignedDriver === p.name).length,
    owners: (p) => vehicles.filter(v => v.owner === p.name).length,
    mechanics: (p) => maintenanceRecords.filter(r => r.mechanic === p.name).length
  };

  function personCell(f, p) {
    const val = p[f.key];
    if (val == null || val === '') return '-';
    if (f.key === 'licenseExpiry') {
      const days = Math.ceil((new Date(val) - Date.now()) / 86400000);
      const [txt, col] = days < 0 ? ['Expired', 'red'] : days <= 30 ? ['Expiring', 'amber'] : ['Valid', 'green'];
      return `${fmtDate(val)} ${badge(txt, col)}`;
    }
    if (f.key === 'status') return badge(val, { 'Available': 'green', 'On Trip': 'amber', 'On Leave': 'red' }[val] || 'green');
    if (f.key === 'hourlyRate') return money(val);
    return esc(val);
  }

  function renderPeople(type) {
    const cfg = PEOPLE[type];
    const q = $(`p-${type}-search`).value.trim().toLowerCase();
    const rows = directory[type].filter(p => !q || cfg.fields.some(f => String(p[f.key] ?? '').toLowerCase().includes(q)));
    $(`p-${type}-body`).innerHTML = rows.length ? rows.map(p => `
      <tr>
        ${cfg.fields.map(f => `<td>${personCell(f, p)}</td>`).join('')}
        <td>${extraCount[type](p)}</td>
        <td class="actions">
          <button class="btn btn-edit" data-action="edit" data-id="${esc(p._id)}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${esc(p._id)}">Delete</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="${cfg.fields.length + 2}" class="empty">No ${cfg.plural.toLowerCase()} found.</td></tr>`;
  }

  async function loadPeople(type) {
    directory[type] = await api(`/${type}`);
    renderPeople(type);
  }

  function resetPersonForm(type) {
    const cfg = PEOPLE[type];
    editing[type] = null;
    $(`p-${type}-form`).reset();
    $(`p-${type}-heading`).textContent = `Add ${cfg.title}`;
    $(`p-${type}-submit`).textContent = `Add ${cfg.title}`;
    $(`p-${type}-cancel`).classList.add('hidden');
  }

  if (isAdmin) Object.entries(PEOPLE).forEach(([type, cfg]) => {
    const input = (f) => f.type === 'select'
      ? `<select id="p-${type}-${f.key}" title="${f.label}">${f.options.map(o => `<option>${o}</option>`).join('')}</select>`
      : `<input id="p-${type}-${f.key}" type="${f.type || 'text'}" placeholder="${f.label}" title="${f.label}" ${f.optional ? '' : 'required'} ${f.type === 'number' ? 'min="0" step="0.01"' : ''}>`;

    $(`tab-${type}`).innerHTML = `
      <div class="card">
        <h3 id="p-${type}-heading">Add ${cfg.title}</h3>
        <p class="note">Contact and licence details. To give someone a login, approve their registration in the Users tab.</p>
        <form id="p-${type}-form" class="form-grid">
          ${cfg.fields.map(input).join('')}
          <button type="submit" id="p-${type}-submit" class="btn span-2">Add ${cfg.title}</button>
          <button type="button" id="p-${type}-cancel" class="btn btn-secondary span-2 hidden">Cancel editing</button>
        </form>
      </div>
      <div class="card">
        <div class="toolbar">
          <h3>${cfg.icon} ${cfg.plural}</h3>
          <div class="toolbar-controls"><input type="search" id="p-${type}-search" placeholder="Search ${cfg.plural.toLowerCase()}..."></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${cfg.fields.map(f => `<th>${f.label}</th>`).join('')}
              <th>${cfg.extraLabel}</th>
              <th>Actions</th>
            </tr></thead>
            <tbody id="p-${type}-body"></tbody>
          </table>
        </div>
      </div>`;

    $(`p-${type}-search`).oninput = () => renderPeople(type);
    $(`p-${type}-cancel`).onclick = () => resetPersonForm(type);

    $(`p-${type}-form`).onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const body = {};
        cfg.fields.forEach(f => {
          const v = $(`p-${type}-${f.key}`).value;
          body[f.key] = f.type === 'number' ? Number(v || 0) : v;
        });
        if (editing[type]) await send('PUT', `/${type}/${editing[type]}`, body);
        else await send('POST', `/${type}`, body);
        resetPersonForm(type);
        await Promise.all([loadPeople(type), refreshHome()]);
      });
    };

    $(`p-${type}-body`).onclick = (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const p = directory[type].find(x => x._id === btn.dataset.id);
      if (btn.dataset.action === 'edit' && p) {
        editing[type] = p._id;
        cfg.fields.forEach(f => {
          const val = p[f.key] ?? '';
          $(`p-${type}-${f.key}`).value = f.type === 'date' ? String(val).slice(0, 10) : val;
        });
        $(`p-${type}-heading`).textContent = `Edit ${cfg.title}`;
        $(`p-${type}-submit`).textContent = 'Save changes';
        $(`p-${type}-cancel`).classList.remove('hidden');
        $(`p-${type}-form`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (btn.dataset.action === 'delete') run(async () => {
        if (!confirm(`Remove this ${cfg.title.toLowerCase()}?`)) return;
        await send('DELETE', `/${type}/${btn.dataset.id}`);
        await Promise.all([loadPeople(type), refreshHome()]);
      });
    };

    renderPeople(type);
  });

  // ---------- user accounts: approvals + roles (Admin) ----------
  const ROLES = ['Admin', 'Driver', 'Owner', 'Mechanic'];
  let users = [];

  function renderUsers() {
    const f = $('userFilter').value;
    $('userTableBody').innerHTML = users.filter(u => !f || u.status === f).map(u => {
      const me = u.email === user.email;
      const act = me ? '<em>You</em>' : `
        ${u.status !== 'Approved' ? `<button class="btn btn-ok" data-act="Approved" data-id="${esc(u._id)}">Approve</button>` : ''}
        ${u.status !== 'Rejected' ? `<button class="btn btn-edit" data-act="Rejected" data-id="${esc(u._id)}">${u.status === 'Pending' ? 'Reject' : 'Revoke'}</button>` : ''}
        <button class="btn btn-danger" data-act="delete" data-id="${esc(u._id)}">Delete</button>`;
      return `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>
          <select data-role-for="${esc(u._id)}" ${me ? 'disabled' : ''}>
            ${ROLES.map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td>${badge(u.status, userColor[u.status])}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td class="actions">${act}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">No accounts found.</td></tr>`;

    const pending = users.filter(u => u.status === 'Pending').length;
    const box = $('pendingAlert');
    if (pending) {
      box.innerHTML = `🔔 ${pending} registration${pending > 1 ? 's are' : ' is'} waiting for your approval. <a href="#" id="goUsers">Review now</a>`;
      box.classList.remove('hidden');
      $('goUsers').onclick = (e) => { e.preventDefault(); $('userFilter').value = 'Pending'; renderUsers(); activateTab('users'); };
    } else {
      box.classList.add('hidden');
    }
  }

  async function loadUsers() {
    if (!isAdmin) return;
    users = await api('/users');
    renderUsers();
  }
  $('userFilter').onchange = renderUsers;

  $('userTableBody').onchange = (e) => {
    const sel = e.target.closest('select[data-role-for]');
    if (!sel) return;
    run(async () => {
      await send('PUT', `/users/${sel.dataset.roleFor}/role`, { role: sel.value });
      await loadUsers();
    });
  };

  $('userTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (btn.dataset.act === 'delete') {
        if (!confirm('Delete this user account?')) return;
        await send('DELETE', `/users/${btn.dataset.id}`);
      } else {
        await send('PUT', `/users/${btn.dataset.id}/status`, { status: btn.dataset.act });
      }
      await Promise.all([loadUsers(), loadOptions()]);
    });
  };

  // ---------- initial load ----------
  const jobs = [loadVehicles(), loadIncidents(), loadMaintenance(), loadOptions(), refreshHome()];
  if (can('trips')) jobs.push(loadTrips());
  if (can('documents')) jobs.push(loadDocuments());
  if (can('fuel')) jobs.push(loadFuel());
  if (can('reports')) jobs.push(loadReport());
  if (isAdmin) jobs.push(loadActivity(), loadPeople('drivers'), loadPeople('owners'), loadPeople('mechanics'), loadUsers());
  run(() => Promise.all(jobs));
}
