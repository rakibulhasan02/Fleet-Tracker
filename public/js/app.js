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
        role: document.getElementById('regRole').value
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
if (window.location.pathname.includes('dashboard.html')) {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  if (!token) {
    window.location.href = 'index.html';
  } else {
    document.getElementById('userInfo').innerText = `${user.name} (${user.role})`;
    loadVehicles();
  }

  document.getElementById('logoutBtn').onclick = () => {
    localStorage.clear();
    window.location.href = 'index.html';
  };

  const vehicleForm = document.getElementById('vehicleForm');
  vehicleForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById('vName').value,
      plateNumber: document.getElementById('vPlate').value,
      model: document.getElementById('vModel').value,
      mileage: Number(document.getElementById('vMileage').value),
      status: document.getElementById('vStatus').value,
      assignedDriver: document.getElementById('vDriver').value || 'Unassigned'
    };

    const res = await fetch(`${API_URL}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      vehicleForm.reset();
      loadVehicles();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to add vehicle');
    }
  };
}

async function loadVehicles() {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}/vehicles`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return;

  const vehicles = await res.json();
  const tbody = document.getElementById('vehicleTableBody');
  tbody.innerHTML = '';

  vehicles.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.name}</td>
      <td>${v.plateNumber}</td>
      <td>${v.model}</td>
      <td>${v.mileage} km</td>
      <td><strong>${v.status}</strong></td>
      <td>${v.assignedDriver}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteVehicle('${v._id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deleteVehicle(id) {
  if (!confirm('Are you sure you want to remove this vehicle?')) return;
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}/vehicles/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.ok) {
    loadVehicles();
  } else {
    alert('Failed to delete vehicle');
  }
}