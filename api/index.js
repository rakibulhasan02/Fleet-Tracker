const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Vehicle = require('../models/Vehicle');

const Document = require('../models/Document');
const Maintenance = require('../models/Maintenance');
const Fuel = require('../models/Fuel');
const Driver = require('../models/Driver');
const Owner = require('../models/Owner');
const Mechanic = require('../models/Mechanic');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Cached MongoDB Connection for Serverless Functions
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is missing');
  }
  const db = await mongoose.connect(process.env.MONGODB_URI);
  isConnected = db.connections[0].readyState;
};

// Middleware: Database Connection
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed: ' + error.message });
  }
});

// Middleware: Authentication Token Check
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized Access' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const current = await User.findById(decoded.id).select('name role');
    if (!current) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = { id: String(current._id), name: current.name, role: current.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const current = await User.findById(req.user.id).select('role');
    if (!current || current.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- ROLE RULES ---
// Admin: everything | Owner: own vehicles, read-only, sees costs
// Driver: assigned vehicle, logs fuel | Mechanic: logs maintenance, sees own jobs, no costs
const allowRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Your role cannot access this' });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameName = (name) => new RegExp(`^${escapeRegex(String(name || '').trim())}$`, 'i');

// Which vehicles can this account see?
const vehicleScope = (user) => {
  if (user.role === 'Owner') return { owner: sameName(user.name) };
  if (user.role === 'Driver') return { assignedDriver: sameName(user.name) };
  return {}; // Admin and Mechanic
};

// Plate numbers this account may see (null = no restriction)
const allowedPlates = async (user) => {
  if (user.role === 'Admin') return null;
  const list = await Vehicle.find(vehicleScope(user)).select('plateNumber').lean();
  return list.map(v => v.plateNumber);
};

const SEES_COSTS = ['Admin', 'Owner'];
const withoutCost = (rec) => { const o = rec.toObject ? rec.toObject() : rec; delete o.cost; return o; };
const handleError = (res, err) => {
  if (err.code === 11000) return res.status(409).json({ error: 'A record with that unique value already exists' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message });
};

// --- AUTH ROUTES ---

// Register: Admin needs the secret code (the very first account becomes Admin automatically)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, adminCode } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const isFirstUser = (await User.countDocuments()) === 0;
    const validRoles = ['Admin', 'Driver', 'Owner', 'Mechanic'];
    let finalRole = validRoles.includes(role) ? role : 'Driver';

    if (isFirstUser) {
      finalRole = 'Admin';
    } else if (finalRole === 'Admin') {
      const secret = process.env.ADMIN_SIGNUP_CODE;
      if (!secret || adminCode !== secret) {
        return res.status(403).json({ error: 'Invalid Admin signup code' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashedPassword, role: finalRole });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    handleError(res, err);
  }
});
// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- VEHICLE CRUD ROUTES ---

// Get vehicles (scoped by role)
app.get('/api/vehicles', authenticate, async (req, res) => {
  try {
    res.json(await Vehicle.find(vehicleScope(req.user)).sort({ createdAt: -1 }));
  } catch (err) {
    handleError(res, err);
  }
});
// Create vehicle (Admin)
app.post('/api/vehicles', authenticate, requireAdmin, async (req, res) => {
  try {
        const { name, plateNumber, model, status, mileage, assignedDriver, owner } = req.body;
    const newVehicle = await Vehicle.create({ name, plateNumber, model, status, mileage, assignedDriver, owner });
    res.status(201).json(newVehicle);
  } catch (err) {
    handleError(res, err);
  }
});

// Update vehicle (Admin)
app.put('/api/vehicles/:id', authenticate, requireAdmin, async (req, res) => {
  try {
        const allowed = ['name', 'plateNumber', 'model', 'status', 'mileage', 'assignedDriver', 'owner'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

// Delete vehicle (Admin)
app.delete('/api/vehicles/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ message: 'Vehicle removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// --- DOCUMENTS ---
app.get('/api/documents', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const plates = await allowedPlates(req.user);
    const filter = plates ? { vehiclePlate: { $in: plates } } : {};
    res.json(await Document.find(filter).sort({ expiryDate: 1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/documents', authenticate, requireAdmin, async (req, res) => {
  try {
    const { vehiclePlate, title, documentType, expiryDate } = req.body;
    res.status(201).json(await Document.create({ vehiclePlate, title, documentType, expiryDate }));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/documents/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const doc = await Document.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ message: 'Document removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// --- MAINTENANCE ---
app.get('/api/maintenance', authenticate, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Mechanic') {
      filter = { mechanic: sameName(req.user.name) };
    } else {
      const plates = await allowedPlates(req.user);
      if (plates) filter = { vehiclePlate: { $in: plates } };
    }
    const records = await Maintenance.find(filter).sort({ date: -1 });
    res.json(SEES_COSTS.includes(req.user.role) ? records : records.map(withoutCost));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/maintenance', authenticate, allowRoles('Admin', 'Mechanic'), async (req, res) => {
  try {
    const { vehiclePlate, type, date, cost, mileageAtService, notes } = req.body;
    const mechanic = req.user.role === 'Mechanic' ? req.user.name : req.body.mechanic;

    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });

    const record = await Maintenance.create({
      vehiclePlate, type, mechanic, date, cost, mileageAtService, notes, loggedBy: req.user.name
    });

    if (mileageAtService > vehicle.mileage) {
      vehicle.mileage = mileageAtService;
      await vehicle.save();
    }
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/maintenance/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const record = await Maintenance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Record removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});


// --- FUEL LOG ---
app.get('/api/fuel', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const plates = await allowedPlates(req.user);
    const filter = plates ? { vehiclePlate: { $in: plates } } : {};
    res.json(await Fuel.find(filter).sort({ date: -1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/fuel', authenticate, allowRoles('Admin', 'Driver'), async (req, res) => {
  try {
    const { vehiclePlate, date, liters, cost, odometer, station } = req.body;

    const plates = await allowedPlates(req.user);
    if (plates && !plates.includes(vehiclePlate)) {
      return res.status(403).json({ error: 'You can only log fuel for your assigned vehicle' });
    }

    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });

    const log = await Fuel.create({ vehiclePlate, date, liters, cost, odometer, station, loggedBy: req.user.name });

    if (odometer > vehicle.mileage) {
      vehicle.mileage = odometer;
      await vehicle.save();
    }
    res.status(201).json(log);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/fuel/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const log = await Fuel.findByIdAndDelete(req.params.id);
    if (!log) return res.status(404).json({ error: 'Fuel log not found' });
    res.json({ message: 'Fuel log removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});


// --- DRIVERS / OWNERS / MECHANICS (generic CRUD) ---
function crud(route, Model) {
   app.get(`/api/${route}`, authenticate, requireAdmin, async (req, res) => {
    try { res.json(await Model.find().sort({ name: 1 })); } catch (err) { handleError(res, err); }
  });
  app.post(`/api/${route}`, authenticate, requireAdmin, async (req, res) => {
    try { res.status(201).json(await Model.create(req.body)); } catch (err) { handleError(res, err); }
  });
  app.put(`/api/${route}/:id`, authenticate, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
      if (!item) return res.status(404).json({ error: 'Record not found' });
      res.json(item);
    } catch (err) { handleError(res, err); }
  });
  app.delete(`/api/${route}/:id`, authenticate, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ error: 'Record not found' });
      res.json({ message: 'Record removed successfully' });
    } catch (err) { handleError(res, err); }
  });
}
crud('drivers', Driver);
crud('owners', Owner);
crud('mechanics', Mechanic);

// --- USER MANAGEMENT (Admin only) ---
const ALL_ROLES = ['Admin', 'Driver', 'Owner', 'Mechanic'];

app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await User.find().select('-password').sort({ createdAt: 1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/users/:id/role', authenticate, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (req.params.id === req.user.id && role !== 'Admin') {
      return res.status(400).json({ error: 'You cannot remove your own Admin role' });
    }
    const target = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password');
    if (!target) return res.status(404).json({ error: 'User not found' });
    res.json(target);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const target = await User.findByIdAndDelete(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});
// --- STATS ---
app.get('/api/stats', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const isAdminUser = req.user.role === 'Admin';
    const plates = await allowedPlates(req.user);
    const byPlate = plates ? { vehiclePlate: { $in: plates } } : {};

    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCMonth(since.getUTCMonth() - 5);

    const monthly = (Model) => Model.aggregate([
      { $match: { ...byPlate, date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: '$cost' } } }
    ]);

    const [vehicles, docs, spend, fuelSpend, mMonthly, fMonthly, fuelLogs, driverCount, ownerCount, mechanicCount] = await Promise.all([
      Vehicle.find(vehicleScope(req.user)).lean(),
      Document.find(byPlate).lean(),
      Maintenance.aggregate([{ $match: byPlate }, { $group: { _id: null, total: { $sum: '$cost' }, count: { $sum: 1 } } }]),
      Fuel.aggregate([{ $match: byPlate }, { $group: { _id: null, total: { $sum: '$cost' }, liters: { $sum: '$liters' } } }]),
      monthly(Maintenance),
      monthly(Fuel),
      Fuel.find({ ...byPlate, odometer: { $ne: null } }).lean(),
      isAdminUser ? Driver.countDocuments() : 0,
      isAdminUser ? Owner.countDocuments() : 0,
      isAdminUser ? Mechanic.countDocuments() : 0
    ]);

    const byStatus = { 'Active': 0, 'In Maintenance': 0, 'Out of Service': 0 };
    vehicles.forEach(v => { byStatus[v.status] = (byStatus[v.status] || 0) + 1; });
    const totalMileage = vehicles.reduce((sum, v) => sum + (v.mileage || 0), 0);

    const docStatuses = docs.map(d => Document.computeStatus(d.expiryDate));

    const mMap = Object.fromEntries(mMonthly.map(x => [x._id, x.total]));
    const fMap = Object.fromEntries(fMonthly.map(x => [x._id, x.total]));
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push({
        label: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
        maintenance: mMap[key] || 0,
        fuel: fMap[key] || 0
      });
    }

    const byVehicle = {};
    fuelLogs.forEach(f => (byVehicle[f.vehiclePlate] = byVehicle[f.vehiclePlate] || []).push(f));
    let km = 0, litres = 0;
    Object.values(byVehicle).forEach(list => {
      if (list.length < 2) return;
      list.sort((a, b) => a.odometer - b.odometer);
      km += list[list.length - 1].odometer - list[0].odometer;
      litres += list.slice(1).reduce((sum, f) => sum + f.liters, 0);
    });

    res.json({
      totalVehicles: vehicles.length,
      byStatus,
      totalMileage,
      avgMileage: vehicles.length ? Math.round(totalMileage / vehicles.length) : 0,
      documents: {
        total: docs.length,
        expired: docStatuses.filter(s => s === 'Expired').length,
        expiringSoon: docStatuses.filter(s => s === 'Expiring Soon').length
      },
      maintenance: { records: spend[0]?.count || 0, totalCost: spend[0]?.total || 0 },
      fuel: {
        totalCost: fuelSpend[0]?.total || 0,
        totalLiters: fuelSpend[0]?.liters || 0,
        kmPerL: litres > 0 ? km / litres : 0
      },
      monthly: months,
      people: isAdminUser ? { drivers: driverCount, owners: ownerCount, mechanics: mechanicCount } : undefined
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = app;