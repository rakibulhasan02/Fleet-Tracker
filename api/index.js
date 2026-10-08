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
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid or expired token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};


const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

const handleError = (res, err) => {
  if (err.code === 11000) return res.status(409).json({ error: 'A record with that unique value already exists' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message });
};

// --- AUTH ROUTES ---

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword, role });
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// Get all vehicles
app.get('/api/vehicles', authenticate, async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ createdAt: -1 });
    res.json(vehicles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create vehicle (Admin)
app.post('/api/vehicles', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, plateNumber, model, status, mileage, assignedDriver } = req.body;
    const newVehicle = await Vehicle.create({ name, plateNumber, model, status, mileage, assignedDriver });
    res.status(201).json(newVehicle);
  } catch (err) {
    handleError(res, err);
  }
});

// Update vehicle (Admin)
app.put('/api/vehicles/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const allowed = ['name', 'plateNumber', 'model', 'status', 'mileage', 'assignedDriver'];
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
app.get('/api/documents', authenticate, async (req, res) => {
  try {
    res.json(await Document.find().sort({ expiryDate: 1 }));
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
    res.json(await Maintenance.find().sort({ date: -1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/maintenance', authenticate, async (req, res) => {
  try {
    const { vehiclePlate, type, date, cost, mileageAtService, notes } = req.body;
    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });

    const record = await Maintenance.create({
      vehiclePlate, type, date, cost, mileageAtService, notes, loggedBy: req.user.name
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
app.get('/api/fuel', authenticate, async (req, res) => {
  try {
    res.json(await Fuel.find().sort({ date: -1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/fuel', authenticate, async (req, res) => {
  try {
    const { vehiclePlate, date, liters, cost, odometer, station } = req.body;
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

// --- STATS ---
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCMonth(since.getUTCMonth() - 5);

    const monthly = (Model) => Model.aggregate([
      { $match: { date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: '$cost' } } }
    ]);

    const [vehicles, docs, spend, fuelSpend, mMonthly, fMonthly, fuelLogs] = await Promise.all([
      Vehicle.find().lean(),
      Document.find().lean(),
      Maintenance.aggregate([{ $group: { _id: null, total: { $sum: '$cost' }, count: { $sum: 1 } } }]),
      Fuel.aggregate([{ $group: { _id: null, total: { $sum: '$cost' }, liters: { $sum: '$liters' } } }]),
      monthly(Maintenance),
      monthly(Fuel),
      Fuel.find({ odometer: { $ne: null } }).lean()
    ]);

    // vehicles
    const byStatus = { 'Active': 0, 'In Maintenance': 0, 'Out of Service': 0 };
    vehicles.forEach(v => { byStatus[v.status] = (byStatus[v.status] || 0) + 1; });
    const totalMileage = vehicles.reduce((sum, v) => sum + (v.mileage || 0), 0);

    // documents
    const docStatuses = docs.map(d => Document.computeStatus(d.expiryDate));

    // last 6 months of spend
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

    // fleet fuel efficiency (km per liter) from odometer readings
    const byPlate = {};
    fuelLogs.forEach(f => (byPlate[f.vehiclePlate] = byPlate[f.vehiclePlate] || []).push(f));
    let km = 0, litres = 0;
    Object.values(byPlate).forEach(list => {
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
      monthly: months
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = app;