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
      alert('Account created! You can now log in.');
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

  const isAdmin = user.role === 'Admin';
  const $ = (id) => document.getElementById(id);
  let vehicles = [];
    let lastStats = null;

  // theme
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('theme', t);
    $('themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
    if (lastStats) renderCharts(lastStats);
  };
  applyTheme(localStorage.getItem('theme') || 'light');
  $('themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // toast notifications
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
  if (!isAdmin) document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    $('logoutBtn').onclick = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = 'index.html'; };

  // helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const badge = (text, color) => `<span class="badge badge-${color}">${esc(text)}</span>`;
  const vehicleColor = { 'Active': 'green', 'In Maintenance': 'amber', 'Out of Service': 'red' };
  const docColor = { 'Valid': 'green', 'Expiring Soon': 'amber', 'Expired': 'red' };

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

  // tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
            document.querySelectorAll('section[id^="tab-"]').forEach(sec => sec.classList.toggle('hidden', sec.id !== `tab-${btn.dataset.tab}`));
    };
  });

    const charts = {};
  function renderCharts(s) {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#64748b';
    Object.values(charts).forEach(c => c.destroy());

    charts.status = new Chart($('statusChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(s.byStatus),
        datasets: [{ data: Object.values(s.byStatus), backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'], borderWidth: 0 }]
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

  async function loadStats() {
    const s = await api('/stats');
    lastStats = s;
    const attention = s.documents.expired + s.documents.expiringSoon;
    $('statsGrid').innerHTML = [
      ['', '🚗', s.totalVehicles, 'Total vehicles'],
      ['green', '✅', s.byStatus['Active'], 'Active'],
      ['amber', '🔧', s.byStatus['In Maintenance'], 'In maintenance'],
      ['red', '⛔', s.byStatus['Out of Service'], 'Out of service'],
      ['', '🛣️', `${s.avgMileage.toLocaleString()} km`, 'Avg. mileage'],
      ['', '⛽', s.fuel.kmPerL ? `${s.fuel.kmPerL.toFixed(1)} km/L` : '—', 'Fleet fuel efficiency'],
      ['', '💰', money(s.maintenance.totalCost + s.fuel.totalCost), 'Total running cost'],
      [attention ? 'red' : 'green', '📄', attention, 'Documents needing attention'],
            ['', '🧑‍✈️', s.people.drivers, 'Drivers'],
      ['', '🏢', s.people.owners, 'Owners'],
      ['', '🛠️', s.people.mechanics, 'Mechanics']
    ].map(([c, icon, v, l]) => `
      <div class="stat ${c}">
        <div class="icon">${icon}</div>
        <div><div class="value">${esc(v)}</div><div class="label">${esc(l)}</div></div>
      </div>`).join('');

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
  // vehicles
   function filteredVehicles() {
    const q = $('vehicleSearch').value.trim().toLowerCase();
    const status = $('vehicleFilter').value;
    return vehicles.filter(v =>
      (!status || v.status === status) &&
      (!q || [v.name, v.plateNumber, v.model, v.assignedDriver, v.owner].some(x => String(x || '').toLowerCase().includes(q)))
    );
  }

  function renderVehicles() {
    const rows = filteredVehicles();
    $('vehicleTableBody').innerHTML = rows.length ? rows.map(v => `
      <tr>
        <td>${esc(v.name)}</td>
        <td><span class="plate">${esc(v.plateNumber)}</span></td>
        <td>${esc(v.model)}</td>
        <td>${Number(v.mileage).toLocaleString()} km</td>
        <td>${badge(v.status, vehicleColor[v.status] || 'green')}</td>
        <td>${esc(v.assignedDriver)}</td>
        <td>${esc(v.owner)}</td>
        ${isAdmin ? `<td>
          <button class="btn btn-edit" data-action="edit" data-id="${esc(v._id)}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${esc(v._id)}">Delete</button>
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="8" class="empty">No vehicles found.</td></tr>`;
  }

  function fillPlateSelects() {
    const options = vehicles.length
      ? vehicles.map(v => `<option value="${esc(v.plateNumber)}">${esc(v.plateNumber)} - ${esc(v.name)}</option>`).join('')
      : '<option value="">Add a vehicle first</option>';
    $('dPlate').innerHTML = options;
    $('mPlate').innerHTML = options;
        $('fPlate').innerHTML = options;
  }

  async function loadVehicles() {
    vehicles = await api('/vehicles');
    renderVehicles();
    fillPlateSelects();
        renderPeople('drivers');
    renderPeople('owners');
  }

  $('vehicleSearch').oninput = renderVehicles;
  $('vehicleFilter').onchange = renderVehicles;

  $('vehicleForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/vehicles', {
        name: $('vName').value,
        plateNumber: $('vPlate').value,
        model: $('vModel').value,
        mileage: Number($('vMileage').value),
        status: $('vStatus').value,
        assignedDriver: $('vDriver').value || 'Unassigned',
                owner: $('vOwner').value || 'Unassigned'
      });
      e.target.reset();
      await Promise.all([loadVehicles(), loadStats()]);
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
      await Promise.all([loadVehicles(), loadStats()]);
    });
  };

  // edit modal
  function openEdit(v) {
    $('eId').value = v._id;
    $('eName').value = v.name;
    $('ePlate').value = v.plateNumber;
    $('eModel').value = v.model;
    $('eMileage').value = v.mileage;
    $('eStatus').value = v.status;
        setSelect('eDriver', v.assignedDriver || 'Unassigned');
    setSelect('eOwner', v.owner || 'Unassigned');
    $('editModal').classList.remove('hidden');
  }
  const closeEdit = () => $('editModal').classList.add('hidden');
  $('editCancel').onclick = closeEdit;
  $('editModal').onclick = (e) => { if (e.target === $('editModal')) closeEdit(); };
  $('editForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('PUT', `/vehicles/${$('eId').value}`, {
        name: $('eName').value,
        plateNumber: $('ePlate').value,
        model: $('eModel').value,
        mileage: Number($('eMileage').value),
        status: $('eStatus').value,
        assignedDriver: $('eDriver').value || 'Unassigned',
                owner: $('eOwner').value || 'Unassigned'
      });
      closeEdit();
      await Promise.all([loadVehicles(), loadStats()]);
    });
  };

  // CSV export
  $('exportBtn').onclick = () => {
    const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
       const csv = [['Name', 'Plate Number', 'Model', 'Mileage (km)', 'Status', 'Driver', 'Owner']]
      .concat(filteredVehicles().map(v => [v.name, v.plateNumber, v.model, v.mileage, v.status, v.assignedDriver, v.owner]))
      .map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `fleet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // documents
  async function loadDocuments() {
    const docs = await api('/documents');
    $('documentTableBody').innerHTML = docs.length ? docs.map(d => {
      const when = d.daysLeft < 0 ? `${-d.daysLeft} days ago` : `in ${d.daysLeft} days`;
      return `<tr>
        <td>${esc(d.vehiclePlate)}</td>
        <td>${esc(d.documentType)}</td>
        <td>${esc(d.title)}</td>
        <td>${fmtDate(d.expiryDate)} <small>(${when})</small></td>
        <td>${badge(d.status, docColor[d.status])}</td>
        ${isAdmin ? `<td><button class="btn btn-danger" data-id="${esc(d._id)}">Delete</button></td>` : ''}
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
      await Promise.all([loadDocuments(), loadStats()]);
    });
  };

  $('documentTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (!confirm('Remove this document?')) return;
      await send('DELETE', `/documents/${btn.dataset.id}`);
      await Promise.all([loadDocuments(), loadStats()]);
    });
  };

  // maintenance
  async function loadMaintenance() {
    const records = await api('/maintenance');
        maintenanceRecords = records;
    renderPeople('mechanics');
    const total = records.reduce((sum, r) => sum + (r.cost || 0), 0);
    $('maintenanceTotal').textContent = records.length ? `Total spend: ${money(total)}` : '';
    $('maintenanceTableBody').innerHTML = records.length ? records.map(r => `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td>${esc(r.vehiclePlate)}</td>
        <td>${esc(r.type)}</td>
                <td>${esc(r.mechanic) || '-'}</td>
        <td>${money(r.cost)}</td>
        <td>${r.mileageAtService != null ? Number(r.mileageAtService).toLocaleString() + ' km' : '-'}</td>
        <td>${esc(r.notes)}</td>
        <td>${esc(r.loggedBy)}</td>
        ${isAdmin ? `<td><button class="btn btn-danger" data-id="${esc(r._id)}">Delete</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="8" class="empty">No maintenance logged yet.</td></tr>`;
  }

  $('mDate').value = new Date().toISOString().slice(0, 10);
  $('maintenanceForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await send('POST', '/maintenance', {
        vehiclePlate: $('mPlate').value,
        type: $('mType').value,
                mechanic: $('mMechanic').value,
        date: $('mDate').value,
        cost: Number($('mCost').value || 0),
        mileageAtService: $('mMileage').value ? Number($('mMileage').value) : undefined,
        notes: $('mNotes').value
      });
      e.target.reset();
      $('mDate').value = new Date().toISOString().slice(0, 10);
      await Promise.all([loadMaintenance(), loadVehicles(), loadStats()]);
    });
  };

  $('maintenanceTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (!confirm('Remove this maintenance record?')) return;
      await send('DELETE', `/maintenance/${btn.dataset.id}`);
      await Promise.all([loadMaintenance(), loadStats()]);
    });
  };

    // fuel
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

  $('fDate').value = new Date().toISOString().slice(0, 10);
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
      $('fDate').value = new Date().toISOString().slice(0, 10);
      await Promise.all([loadFuel(), loadVehicles(), loadStats()]);
    });
  };

  $('fuelTableBody').onclick = (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    run(async () => {
      if (!confirm('Remove this fuel log?')) return;
      await send('DELETE', `/fuel/${btn.dataset.id}`);
      await Promise.all([loadFuel(), loadStats()]);
    });
  };
    // ---------- drivers / owners / mechanics ----------
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
  let maintenanceRecords = [];

  const extraCount = {
    drivers: (p) => vehicles.filter(v => v.assignedDriver === p.name).length,
    owners: (p) => vehicles.filter(v => v.owner === p.name).length,
    mechanics: (p) => maintenanceRecords.filter(r => r.mechanic === p.name).length
  };

  function setSelect(id, value) {
    const el = $(id);
    if (value && ![...el.options].some(o => o.value === value)) el.add(new Option(value, value));
    el.value = value || (el.options[0] ? el.options[0].value : '');
  }

  function fillPersonSelects() {
    const list = (items, first) => `<option value="${first[0]}">${first[1]}</option>` +
      items.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const drivers = list(directory.drivers, ['Unassigned', 'Unassigned']);
    const owners = list(directory.owners, ['Unassigned', 'Unassigned']);
    ['vDriver', 'eDriver'].forEach(id => { $(id).innerHTML = drivers; });
    ['vOwner', 'eOwner'].forEach(id => { $(id).innerHTML = owners; });
    $('mMechanic').innerHTML = list(directory.mechanics, ['', '— No mechanic —']);
  }

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
        ${isAdmin ? `<td>
          <button class="btn btn-edit" data-action="edit" data-id="${esc(p._id)}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-id="${esc(p._id)}">Delete</button>
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${cfg.fields.length + 2}" class="empty">No ${cfg.plural.toLowerCase()} found.</td></tr>`;
  }

  async function loadPeople(type) {
    directory[type] = await api(`/${type}`);
    renderPeople(type);
    fillPersonSelects();
  }

  function resetPersonForm(type) {
    const cfg = PEOPLE[type];
    editing[type] = null;
    $(`p-${type}-form`).reset();
    $(`p-${type}-heading`).textContent = `Add ${cfg.title}`;
    $(`p-${type}-submit`).textContent = `Add ${cfg.title}`;
    $(`p-${type}-cancel`).classList.add('hidden');
  }

  Object.entries(PEOPLE).forEach(([type, cfg]) => {
    const input = (f) => f.type === 'select'
      ? `<select id="p-${type}-${f.key}" title="${f.label}">${f.options.map(o => `<option>${o}</option>`).join('')}</select>`
      : `<input id="p-${type}-${f.key}" type="${f.type || 'text'}" placeholder="${f.label}" title="${f.label}" ${f.optional ? '' : 'required'} ${f.type === 'number' ? 'min="0" step="0.01"' : ''}>`;

    $(`tab-${type}`).innerHTML = `
      <div class="card admin-only">
        <h3 id="p-${type}-heading">Add ${cfg.title}</h3>
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
              <th class="admin-only">Actions</th>
            </tr></thead>
            <tbody id="p-${type}-body"></tbody>
          </table>
        </div>
      </div>`;

    if (!isAdmin) $(`tab-${type}`).querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));

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
        await Promise.all([loadPeople(type), loadStats()]);
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
        await Promise.all([loadPeople(type), loadStats()]);
      });
    };

    renderPeople(type);
  });
    // ---------- user accounts (Admin only) ----------
  const ROLES = ['Admin', 'Driver', 'Owner', 'Mechanic'];

  async function loadUsers() {
    if (!isAdmin) return;
    const users = await api('/users');
    $('userTableBody').innerHTML = users.map(u => {
      const me = u.email === user.email;
      return `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td>
          <select data-role-for="${esc(u._id)}" ${me ? 'disabled' : ''}>
            ${ROLES.map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>${me ? '<em>You</em>' : `<button class="btn btn-danger" data-id="${esc(u._id)}">Delete</button>`}</td>
      </tr>`;
    }).join('');
  }

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
      if (!confirm('Delete this user account?')) return;
      await send('DELETE', `/users/${btn.dataset.id}`);
      await loadUsers();
    });
  };
  // initial load
        run(() => Promise.all([
    loadPeople('drivers'), loadPeople('owners'), loadPeople('mechanics'),
    loadVehicles(), loadDocuments(), loadMaintenance(), loadFuel(), loadStats(), loadUsers()
  ]));
}