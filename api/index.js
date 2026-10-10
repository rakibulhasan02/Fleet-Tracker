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
const Trip = require('../models/Trip');
const Incident = require('../models/Incident');
const Activity = require('../models/Activity');

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const httpError = (status, message) => Object.assign(new Error(message), { status });

const handleError = (res, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 11000) return res.status(409).json({ error: 'A record with that unique value already exists' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message });
};

// Audit trail (awaited, because serverless functions may stop right after the response)
const track = (user, action, details = '') =>
  Activity.create({ user: user?.name || 'System', role: user?.role || '', action, details: String(details) }).catch(() => {});

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameName = (name) => new RegExp(`^${escapeRegex(String(name || '').trim())}$`, 'i');
const num = (v) => (v === '' || v == null ? undefined : Number(v));
const isApproved = (u) => !u.status || u.status === 'Approved'; // old accounts have no status

// ---------------------------------------------------------------------------
// Authentication & role rules
//
//  Admin    : everything; approves registrations; reports; activity log
//  Owner    : own vehicles (add/edit/delete), assigns drivers, sees status,
//             location, fuel + maintenance costs, trips, problems, reports
//  Driver   : assigned vehicle, own trips (start/complete/update), fuel logs,
//             accident / problem reports
//  Mechanic : repair queue, problem diagnosis, repairs + parts + costs,
//             marks vehicles Ready or Under Maintenance
// ---------------------------------------------------------------------------
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized Access' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const current = await User.findById(decoded.id).select('name role status');
    if (!current) return res.status(401).json({ error: 'Account no longer exists' });
    if (!isApproved(current)) return res.status(403).json({ error: 'Your account is not approved' });
    req.user = { id: String(current._id), name: current.name, role: current.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const allowRoles = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Your role cannot access this' });
const requireAdmin = allowRoles('Admin');

// Which vehicles can this account see?
const vehicleScope = (user) => {
  if (user.role === 'Owner') return { $or: [{ ownerId: user.id }, { owner: sameName(user.name) }] };
  if (user.role === 'Driver') return { $or: [{ assignedDriverId: user.id }, { assignedDriver: sameName(user.name) }] };
  return {}; // Admin and Mechanic
};

// Plate numbers this account may see (null = no restriction)
const allowedPlates = async (user) => {
  if (user.role === 'Admin') return null;
  const list = await Vehicle.find(vehicleScope(user)).select('plateNumber').lean();
  return list.map(v => v.plateNumber);
};
const plateFilter = (plates) => (plates ? { vehiclePlate: { $in: plates } } : {});

const SEES_COSTS = ['Admin', 'Owner', 'Mechanic']; // mechanics only ever get their own jobs
const withoutCost = (rec) => {
  const o = rec.toObject ? rec.toObject() : { ...rec };
  delete o.cost; delete o.laborCost;
  o.parts = (o.parts || []).map(p => ({ name: p.name, quantity: p.quantity }));
  return o;
};

// An approved account of a given role (used when assigning drivers / owners)
const findApproved = async (id, role) => {
  const u = await User.findOne({ _id: id, role }).select('name status');
  if (!u || !isApproved(u)) throw httpError(400, `${role} account not found or not approved yet`);
  return u;
};

// Apply driver / owner assignment from a request body onto a vehicle update object
async function applyAssignments(data, body, user) {
  if (body.driverId !== undefined) {
    if (body.driverId) {
      const d = await findApproved(body.driverId, 'Driver');
      data.assignedDriver = d.name; data.assignedDriverId = d._id;
    } else {
      data.assignedDriver = 'Unassigned'; data.assignedDriverId = null;
    }
  } else if (user.role === 'Admin' && body.assignedDriver !== undefined) {
    data.assignedDriver = body.assignedDriver || 'Unassigned'; data.assignedDriverId = null;
  }
  if (user.role === 'Admin') {
    if (body.ownerId !== undefined) {
      if (body.ownerId) {
        const o = await findApproved(body.ownerId, 'Owner');
        data.owner = o.name; data.ownerId = o._id;
      } else {
        data.owner = 'Unassigned'; data.ownerId = null;
      }
    } else if (body.owner !== undefined) {
      data.owner = body.owner || 'Unassigned'; data.ownerId = null;
    }
  }
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------

// Register. Driver / Owner / Mechanic accounts wait for Admin approval.
// The very first account becomes Admin; other Admins need the secret code.
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, adminCode } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const isFirstUser = (await User.countDocuments()) === 0;
    const validRoles = ['Admin', 'Driver', 'Owner', 'Mechanic'];
    let finalRole = validRoles.includes(role) ? role : 'Driver';
    let status = 'Pending';

    if (isFirstUser) {
      finalRole = 'Admin';
      status = 'Approved';
    } else if (finalRole === 'Admin') {
      const secret = process.env.ADMIN_SIGNUP_CODE;
      if (!secret || adminCode !== secret) {
        return res.status(403).json({ error: 'Invalid Admin signup code' });
      }
      status = 'Approved';
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name: String(name).trim(), email, password: hashedPassword, role: finalRole, status });
    await track({ name: String(name).trim(), role: finalRole }, 'Registered', status === 'Pending' ? 'Waiting for approval' : 'Approved automatically');
    res.status(201).json({
      status,
      message: status === 'Pending'
        ? 'Registration submitted. An Admin must approve your account before you can log in.'
        : 'User registered successfully'
    });
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

    if (user.status === 'Pending') return res.status(403).json({ error: 'Your account is still waiting for Admin approval.' });
    if (user.status === 'Rejected') return res.status(403).json({ error: 'Your registration was not approved. Please contact the Admin.' });

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approved driver / owner / mechanic accounts for assignment dropdowns
app.get('/api/people', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const roles = req.user.role === 'Admin' ? ['Driver', 'Owner', 'Mechanic'] : ['Driver'];
    const users = await User.find({ role: { $in: roles } }).select('name role status').sort({ name: 1 });
    const out = { drivers: [], owners: [], mechanics: [] };
    users.filter(isApproved).forEach(u => out[u.role.toLowerCase() + 's'].push({ id: String(u._id), name: u.name }));
    res.json(out);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// VEHICLES  (Admin: all | Owner: own | Driver: assigned | Mechanic: all, read + status)
// ---------------------------------------------------------------------------
app.get('/api/vehicles', authenticate, async (req, res) => {
  try {
    res.json(await Vehicle.find(vehicleScope(req.user)).sort({ createdAt: -1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/vehicles', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const { name, plateNumber, model, status, mileage } = req.body;
    const data = { name, plateNumber: String(plateNumber || '').trim(), model, status, mileage };
    if (req.user.role === 'Owner') { data.owner = req.user.name; data.ownerId = req.user.id; }
    await applyAssignments(data, req.body, req.user);
    const vehicle = await Vehicle.create(data);
    await track(req.user, 'Added vehicle', `${vehicle.plateNumber} (${vehicle.name})`);
    res.status(201).json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/vehicles/:id', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...(req.user.role === 'Owner' ? vehicleScope(req.user) : {}) };
    const vehicle = await Vehicle.findOne(filter);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const oldPlate = vehicle.plateNumber;
    const updates = {};
    ['name', 'plateNumber', 'model', 'status', 'mileage'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.plateNumber) updates.plateNumber = String(updates.plateNumber).trim();
    await applyAssignments(updates, req.body, req.user);
    vehicle.set(updates);
    await vehicle.save();

    // Keep history attached to the vehicle if its plate number is corrected
    if (vehicle.plateNumber !== oldPlate) {
      await Promise.all([Fuel, Maintenance, Document, Trip, Incident]
        .map(M => M.updateMany({ vehiclePlate: oldPlate }, { vehiclePlate: vehicle.plateNumber })));
    }
    await track(req.user, 'Updated vehicle', `${vehicle.plateNumber}${updates.assignedDriver ? ` - driver: ${updates.assignedDriver}` : ''}`);
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

// Change only the status. Mechanics: Ready (Active) <-> Under Maintenance.
app.put('/api/vehicles/:id/status', authenticate, allowRoles('Admin', 'Owner', 'Mechanic'), async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = req.user.role === 'Mechanic'
      ? ['Active', 'In Maintenance']
      : ['Active', 'Needs Repair', 'In Maintenance', 'Out of Service'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `You cannot set the status to "${status}"` });

    const filter = { _id: req.params.id, ...(req.user.role === 'Owner' ? vehicleScope(req.user) : {}) };
    const vehicle = await Vehicle.findOne(filter);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const before = vehicle.status;
    vehicle.status = status;
    await vehicle.save();
    await track(req.user, status === 'Active' ? 'Marked vehicle Ready' : `Set vehicle ${status}`, `${vehicle.plateNumber} (was ${before})`);
    res.json(vehicle);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/vehicles/:id', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...(req.user.role === 'Owner' ? vehicleScope(req.user) : {}) };
    const vehicle = await Vehicle.findOneAndDelete(filter);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    await track(req.user, 'Removed vehicle', `${vehicle.plateNumber} (${vehicle.name})`);
    res.json({ message: 'Vehicle removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// DOCUMENTS (Admin + Owner manage, Driver reads)
// ---------------------------------------------------------------------------
app.get('/api/documents', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const plates = await allowedPlates(req.user);
    res.json(await Document.find(plateFilter(plates)).sort({ expiryDate: 1 }));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/documents', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const { vehiclePlate, title, documentType, expiryDate } = req.body;
    const plates = await allowedPlates(req.user);
    if (plates && !plates.includes(vehiclePlate)) return res.status(403).json({ error: 'You can only add documents to your own vehicles' });
    const doc = await Document.create({ vehiclePlate, title, documentType, expiryDate });
    await track(req.user, 'Added document', `${documentType} for ${vehiclePlate}`);
    res.status(201).json(doc);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/documents/:id', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const plates = await allowedPlates(req.user);
    if (plates && !plates.includes(doc.vehiclePlate)) return res.status(403).json({ error: 'Not your vehicle' });
    await doc.deleteOne();
    await track(req.user, 'Removed document', `${doc.documentType} for ${doc.vehiclePlate}`);
    res.json({ message: 'Document removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// TRIPS  (Admin/Owner assign, Driver starts / completes / updates)
// ---------------------------------------------------------------------------
const TRIP_BLOCKED = ['Needs Repair', 'In Maintenance', 'Out of Service'];
const LIVE_TRIP = ['In Progress', 'Delayed'];

async function driverForVehicle(vehicle) {
  if (vehicle.assignedDriverId) return User.findById(vehicle.assignedDriverId).select('name');
  if (vehicle.assignedDriver && vehicle.assignedDriver !== 'Unassigned') {
    return User.findOne({ role: 'Driver', name: sameName(vehicle.assignedDriver) }).select('name');
  }
  return null;
}

const addNote = (trip, user, text) => {
  if (!text || !String(text).trim()) return;
  const line = `[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] ${user.name}: ${String(text).trim()}`;
  trip.notes = trip.notes ? `${trip.notes}\n${line}` : line;
};

// Loads a trip and checks that this user may act on it as the driver
async function tripForDriverAction(req) {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw httpError(404, 'Trip not found');
  if (req.user.role === 'Driver' && String(trip.driverId) !== req.user.id) throw httpError(403, 'This trip is not assigned to you');
  return trip;
}

const setLocation = (vehicle, lat, lng) => {
  lat = Number(lat); lng = Number(lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    vehicle.location = { lat, lng, updatedAt: new Date() };
  }
};

app.get('/api/trips', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Driver') filter = { driverId: req.user.id };
    else if (req.user.role === 'Owner') filter = plateFilter(await allowedPlates(req.user));
    res.json(await Trip.find(filter).sort({ createdAt: -1 }).limit(500));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/trips', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const { vehiclePlate, driverId, origin, destination, purpose } = req.body;
    const plates = await allowedPlates(req.user);
    if (plates && !plates.includes(vehiclePlate)) return res.status(403).json({ error: 'You can only create trips for your own vehicles' });

    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });
    if (TRIP_BLOCKED.includes(vehicle.status)) return res.status(400).json({ error: `This vehicle is "${vehicle.status}" and cannot take a trip` });

    let driver;
    if (req.user.role === 'Driver') driver = { _id: req.user.id, name: req.user.name };
    else if (driverId) driver = await findApproved(driverId, 'Driver');
    else driver = await driverForVehicle(vehicle);
    if (!driver) return res.status(400).json({ error: 'Choose a driver, or assign a driver to this vehicle first' });

    const trip = await Trip.create({
      vehiclePlate, driverId: driver._id, driverName: driver.name,
      origin, destination, purpose, createdBy: req.user.name
    });
    await track(req.user, 'Created trip', `${vehiclePlate}: ${origin} to ${destination} (${driver.name})`);
    res.status(201).json(trip);
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/trips/:id/start', authenticate, allowRoles('Admin', 'Driver'), async (req, res) => {
  try {
    const trip = await tripForDriverAction(req);
    if (trip.status !== 'Assigned') return res.status(409).json({ error: `A ${trip.status} trip cannot be started` });

    const vehicle = await Vehicle.findOne({ plateNumber: trip.vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'Vehicle no longer exists' });
    if (TRIP_BLOCKED.includes(vehicle.status)) return res.status(400).json({ error: `Vehicle is "${vehicle.status}" and cannot be driven` });

    const busy = await Trip.findOne({ driverId: trip.driverId, status: { $in: LIVE_TRIP }, _id: { $ne: trip._id } });
    if (busy) return res.status(409).json({ error: 'Finish your current trip before starting another' });

    const start = num(req.body.startOdometer);
    if (start !== undefined && (!Number.isFinite(start) || start < 0)) return res.status(400).json({ error: 'Invalid start odometer' });
    trip.startOdometer = start !== undefined ? start : vehicle.mileage;
    trip.status = 'In Progress';
    trip.startedAt = new Date();
    setLocation(vehicle, req.body.lat, req.body.lng);
    if (trip.startOdometer > vehicle.mileage) vehicle.mileage = trip.startOdometer;
    await Promise.all([trip.save(), vehicle.save()]);
    await track(req.user, 'Started trip', `${trip.vehiclePlate}: ${trip.origin} to ${trip.destination}`);
    res.json(trip);
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/trips/:id/complete', authenticate, allowRoles('Admin', 'Driver'), async (req, res) => {
  try {
    const trip = await tripForDriverAction(req);
    if (!LIVE_TRIP.includes(trip.status)) return res.status(409).json({ error: 'Only a trip in progress can be completed' });

    const end = num(req.body.endOdometer);
    if (!Number.isFinite(end) || end < 0) return res.status(400).json({ error: 'End odometer is required' });
    if (trip.startOdometer != null && end < trip.startOdometer) return res.status(400).json({ error: 'End odometer cannot be below the start odometer' });

    trip.endOdometer = end;
    trip.status = 'Completed';
    trip.completedAt = new Date();
    addNote(trip, req.user, req.body.notes);

    const vehicle = await Vehicle.findOne({ plateNumber: trip.vehiclePlate });
    if (vehicle) {
      if (end > vehicle.mileage) vehicle.mileage = end;
      setLocation(vehicle, req.body.lat, req.body.lng);
      await vehicle.save();
    }
    await trip.save();
    await track(req.user, 'Completed trip', `${trip.vehiclePlate}: ${end - (trip.startOdometer || end)} km`);
    res.json(trip);
  } catch (err) {
    handleError(res, err);
  }
});

// Update trip status: Delayed / resume / Cancelled
app.put('/api/trips/:id/status', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const { status, note } = req.body;
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    if (req.user.role === 'Driver' && String(trip.driverId) !== req.user.id) return res.status(403).json({ error: 'This trip is not assigned to you' });
    if (req.user.role === 'Owner') {
      const plates = await allowedPlates(req.user);
      if (!plates.includes(trip.vehiclePlate)) return res.status(403).json({ error: 'Not your vehicle' });
      if (status !== 'Cancelled') return res.status(403).json({ error: 'Owners can only cancel trips' });
    }

    const moves = {
      'Assigned': ['Cancelled'],
      'In Progress': ['Delayed', 'Cancelled'],
      'Delayed': ['In Progress', 'Cancelled']
    };
    if (!(moves[trip.status] || []).includes(status)) return res.status(409).json({ error: `A ${trip.status} trip cannot change to ${status}` });

    trip.status = status;
    addNote(trip, req.user, note);
    await trip.save();
    await track(req.user, `Trip ${status}`, `${trip.vehiclePlate}: ${trip.origin} to ${trip.destination}`);
    res.json(trip);
  } catch (err) {
    handleError(res, err);
  }
});

// Driver's phone reports its position while the trip is live
app.put('/api/trips/:id/location', authenticate, allowRoles('Driver'), async (req, res) => {
  try {
    const trip = await tripForDriverAction(req);
    if (!LIVE_TRIP.includes(trip.status)) return res.status(409).json({ error: 'Trip is not in progress' });
    const vehicle = await Vehicle.findOne({ plateNumber: trip.vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'Vehicle no longer exists' });
    setLocation(vehicle, req.body.lat, req.body.lng);
    await vehicle.save();
    res.json({ location: vehicle.location });
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/trips/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const trip = await Trip.findByIdAndDelete(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    await track(req.user, 'Deleted trip', `${trip.vehiclePlate}: ${trip.origin} to ${trip.destination}`);
    res.json({ message: 'Trip removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PROBLEM / ACCIDENT REPORTS  (Driver reports, Mechanic diagnoses + resolves)
// ---------------------------------------------------------------------------
app.get('/api/incidents', authenticate, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Owner') filter = plateFilter(await allowedPlates(req.user));
    else if (req.user.role === 'Driver') {
      const plates = await allowedPlates(req.user);
      filter = { $or: [{ reportedById: req.user.id }, { vehiclePlate: { $in: plates } }] };
    }
    res.json(await Incident.find(filter).sort({ createdAt: -1 }).limit(500));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/incidents', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const { vehiclePlate, type, severity, description } = req.body;
    const plates = await allowedPlates(req.user);
    if (plates && !plates.includes(vehiclePlate)) return res.status(403).json({ error: 'You can only report problems on your own vehicle' });

    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });

    const incident = await Incident.create({
      vehiclePlate, type, severity, description,
      reportedBy: req.user.name, reportedById: req.user.id
    });

    // The mechanic's repair queue picks this vehicle up
    if (vehicle.status === 'Active') {
      vehicle.status = 'Needs Repair';
      await vehicle.save();
    }
    await track(req.user, `Reported ${type}`, `${vehiclePlate} (${incident.severity}): ${String(description).slice(0, 120)}`);
    res.status(201).json(incident);
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/incidents/:id', authenticate, allowRoles('Admin', 'Mechanic'), async (req, res) => {
  try {
    const { status, diagnosis } = req.body;
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Report not found' });

    if (status !== undefined) {
      if (!['Reported', 'Diagnosed', 'In Repair', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      incident.status = status;
      if (status === 'Resolved') { incident.resolvedBy = req.user.name; incident.resolvedAt = new Date(); }
    }
    if (diagnosis !== undefined) incident.diagnosis = String(diagnosis).trim();
    await incident.save();

    const vehicle = await Vehicle.findOne({ plateNumber: incident.vehiclePlate });
    if (vehicle) {
      if (incident.status === 'In Repair' && vehicle.status === 'Needs Repair') vehicle.status = 'In Maintenance';
      if (incident.status === 'Resolved' && vehicle.status === 'Needs Repair') {
        const stillOpen = await Incident.countDocuments({ vehiclePlate: incident.vehiclePlate, status: { $ne: 'Resolved' } });
        if (!stillOpen) vehicle.status = 'Active';
      }
      await vehicle.save();
    }
    await track(req.user, `Problem ${incident.status}`, `${incident.vehiclePlate}: ${incident.type}`);
    res.json(incident);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/incidents/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const incident = await Incident.findByIdAndDelete(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Report not found' });
    await track(req.user, 'Deleted problem report', `${incident.vehiclePlate}: ${incident.type}`);
    res.json({ message: 'Report removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// MAINTENANCE  (Mechanic records repairs, parts and costs; Admin manages all)
// ---------------------------------------------------------------------------
const cleanParts = (parts) => (Array.isArray(parts) ? parts : [])
  .filter(p => p && String(p.name || '').trim())
  .map(p => ({
    name: String(p.name).trim(),
    quantity: Math.max(1, Number(p.quantity) || 1),
    unitCost: Math.max(0, Number(p.unitCost) || 0)
  }));
const partsTotal = (parts) => parts.reduce((s, p) => s + p.quantity * p.unitCost, 0);

app.get('/api/maintenance', authenticate, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Mechanic') {
      filter = { mechanic: sameName(req.user.name) };
    } else {
      filter = plateFilter(await allowedPlates(req.user));
    }
    const records = await Maintenance.find(filter).sort({ date: -1 });
    res.json(SEES_COSTS.includes(req.user.role) ? records : records.map(withoutCost));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/maintenance', authenticate, allowRoles('Admin', 'Mechanic'), async (req, res) => {
  try {
    const { vehiclePlate, type, date, mileageAtService, notes, incidentId, vehicleStatusAfter } = req.body;
    const mechanic = req.user.role === 'Mechanic' ? req.user.name : req.body.mechanic;

    const vehicle = await Vehicle.findOne({ plateNumber: vehiclePlate });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle with that plate number' });

    const parts = cleanParts(req.body.parts);
    const hasBreakdown = req.body.laborCost !== undefined || parts.length > 0;
    const laborCost = Math.max(0, Number(req.body.laborCost) || 0);
    const cost = hasBreakdown ? laborCost + partsTotal(parts) : Math.max(0, Number(req.body.cost) || 0);

    let incident = null;
    if (incidentId) {
      incident = await Incident.findById(incidentId);
      if (!incident || incident.vehiclePlate !== vehiclePlate) return res.status(400).json({ error: 'That problem report does not belong to this vehicle' });
    }

    const record = await Maintenance.create({
      vehiclePlate, type, mechanic, date, cost, laborCost: hasBreakdown ? laborCost : undefined,
      parts, mileageAtService: num(mileageAtService), notes, incidentId: incident ? incident._id : null,
      loggedBy: req.user.name
    });

    if (mileageAtService > vehicle.mileage) vehicle.mileage = mileageAtService;

    // Vehicle status after the job: Ready (Active) or Under Maintenance
    if (['Active', 'In Maintenance'].includes(vehicleStatusAfter)) vehicle.status = vehicleStatusAfter;
    else if (vehicle.status === 'Needs Repair') vehicle.status = 'In Maintenance'; // work has started
    await vehicle.save();

    if (incident) {
      incident.status = vehicle.status === 'Active' ? 'Resolved' : 'In Repair';
      if (incident.status === 'Resolved') { incident.resolvedBy = req.user.name; incident.resolvedAt = new Date(); }
      await incident.save();
    }
    await track(req.user, 'Logged maintenance', `${vehiclePlate}: ${type}${parts.length ? ` (${parts.length} part${parts.length > 1 ? 's' : ''})` : ''}`);
    res.status(201).json(record);
  } catch (err) {
    handleError(res, err);
  }
});

// Update a repair record: costs, parts, notes (a mechanic can only edit their own jobs)
app.put('/api/maintenance/:id', authenticate, allowRoles('Admin', 'Mechanic'), async (req, res) => {
  try {
    const record = await Maintenance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    if (req.user.role === 'Mechanic' && !sameName(req.user.name).test(record.mechanic || '')) {
      return res.status(403).json({ error: 'You can only edit your own repair records' });
    }

    ['type', 'date', 'notes'].forEach(k => { if (req.body[k] !== undefined) record[k] = req.body[k]; });
    if (req.body.mileageAtService !== undefined) record.mileageAtService = num(req.body.mileageAtService);

    if (req.body.laborCost !== undefined || req.body.parts !== undefined) {
      const parts = req.body.parts !== undefined ? cleanParts(req.body.parts) : record.parts;
      const labor = req.body.laborCost !== undefined ? Math.max(0, Number(req.body.laborCost) || 0) : (record.laborCost || 0);
      record.parts = parts;
      record.laborCost = labor;
      record.cost = labor + partsTotal(parts);
    } else if (req.body.cost !== undefined) {
      record.cost = Math.max(0, Number(req.body.cost) || 0);
    }
    await record.save();
    await track(req.user, 'Updated repair record', `${record.vehiclePlate}: ${record.type}, cost ${record.cost}`);
    res.json(record);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/maintenance/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const record = await Maintenance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    await track(req.user, 'Deleted maintenance record', `${record.vehiclePlate}: ${record.type}`);
    res.json({ message: 'Record removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// FUEL LOG  (Driver submits, Owner checks costs, Admin manages)
// ---------------------------------------------------------------------------
app.get('/api/fuel', authenticate, allowRoles('Admin', 'Owner', 'Driver'), async (req, res) => {
  try {
    const plates = await allowedPlates(req.user);
    res.json(await Fuel.find(plateFilter(plates)).sort({ date: -1 }));
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
    await track(req.user, 'Logged fuel', `${vehiclePlate}: ${liters} L`);
    res.status(201).json(log);
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/fuel/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const log = await Fuel.findByIdAndDelete(req.params.id);
    if (!log) return res.status(404).json({ error: 'Fuel log not found' });
    await track(req.user, 'Deleted fuel log', log.vehiclePlate);
    res.json({ message: 'Fuel log removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// DRIVERS / OWNERS / MECHANICS directory profiles (Admin)
// ---------------------------------------------------------------------------
function crud(route, Model, label) {
  app.get(`/api/${route}`, authenticate, requireAdmin, async (req, res) => {
    try { res.json(await Model.find().sort({ name: 1 })); } catch (err) { handleError(res, err); }
  });
  app.post(`/api/${route}`, authenticate, requireAdmin, async (req, res) => {
    try {
      const item = await Model.create(req.body);
      await track(req.user, `Added ${label}`, item.name);
      res.status(201).json(item);
    } catch (err) { handleError(res, err); }
  });
  app.put(`/api/${route}/:id`, authenticate, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
      if (!item) return res.status(404).json({ error: 'Record not found' });
      await track(req.user, `Updated ${label}`, item.name);
      res.json(item);
    } catch (err) { handleError(res, err); }
  });
  app.delete(`/api/${route}/:id`, authenticate, requireAdmin, async (req, res) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ error: 'Record not found' });
      await track(req.user, `Removed ${label}`, item.name);
      res.json({ message: 'Record removed successfully' });
    } catch (err) { handleError(res, err); }
  });
}
crud('drivers', Driver, 'driver');
crud('owners', Owner, 'owner');
crud('mechanics', Mechanic, 'mechanic');

// ---------------------------------------------------------------------------
// USER MANAGEMENT (Admin): approve / reject registrations, roles, delete
// ---------------------------------------------------------------------------
const ALL_ROLES = ['Admin', 'Driver', 'Owner', 'Mechanic'];
const withStatus = (u) => ({ ...u.toObject(), status: u.status || 'Approved' });

app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = (await User.find().select('-password').sort({ createdAt: 1 })).map(withStatus);
    const rank = { Pending: 0, Approved: 1, Rejected: 2 };
    users.sort((a, b) => rank[a.status] - rank[b.status]);
    res.json(users);
  } catch (err) {
    handleError(res, err);
  }
});

app.put('/api/users/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Status must be Approved or Rejected' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own status' });
    const target = await User.findByIdAndUpdate(
      req.params.id, { status, reviewedBy: req.user.name, reviewedAt: new Date() }, { new: true }
    ).select('-password');
    if (!target) return res.status(404).json({ error: 'User not found' });
    await track(req.user, status === 'Approved' ? 'Approved registration' : 'Rejected registration', `${target.name} (${target.role})`);
    res.json(withStatus(target));
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
    await track(req.user, 'Changed role', `${target.name} is now ${role}`);
    res.json(withStatus(target));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const target = await User.findByIdAndDelete(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    await track(req.user, 'Deleted user', `${target.name} (${target.role})`);
    res.json({ message: 'User removed successfully' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// ACTIVITY LOG (Admin monitors fleet activity)
// ---------------------------------------------------------------------------
app.get('/api/activity', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await Activity.find().sort({ createdAt: -1 }).limit(300));
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// STATS (Admin + Owner dashboards)
// ---------------------------------------------------------------------------
app.get('/api/stats', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const isAdminUser = req.user.role === 'Admin';
    const plates = await allowedPlates(req.user);
    const byPlate = plateFilter(plates);

    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCMonth(since.getUTCMonth() - 5);

    const monthly = (Model) => Model.aggregate([
      { $match: { ...byPlate, date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, total: { $sum: '$cost' } } }
    ]);

    const [vehicles, docs, spend, fuelSpend, mMonthly, fMonthly, fuelLogs, driverCount, ownerCount, mechanicCount,
      activeTrips, plannedTrips, openProblems, pendingUsers] = await Promise.all([
      Vehicle.find(vehicleScope(req.user)).lean(),
      Document.find(byPlate).lean(),
      Maintenance.aggregate([{ $match: byPlate }, { $group: { _id: null, total: { $sum: '$cost' }, count: { $sum: 1 } } }]),
      Fuel.aggregate([{ $match: byPlate }, { $group: { _id: null, total: { $sum: '$cost' }, liters: { $sum: '$liters' } } }]),
      monthly(Maintenance),
      monthly(Fuel),
      Fuel.find({ ...byPlate, odometer: { $ne: null } }).lean(),
      isAdminUser ? Driver.countDocuments() : 0,
      isAdminUser ? Owner.countDocuments() : 0,
      isAdminUser ? Mechanic.countDocuments() : 0,
      Trip.countDocuments({ ...byPlate, status: { $in: LIVE_TRIP } }),
      Trip.countDocuments({ ...byPlate, status: 'Assigned' }),
      Incident.countDocuments({ ...byPlate, status: { $ne: 'Resolved' } }),
      isAdminUser ? User.countDocuments({ status: 'Pending' }) : 0
    ]);

    const byStatus = { 'Active': 0, 'Needs Repair': 0, 'In Maintenance': 0, 'Out of Service': 0 };
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
      trips: { active: activeTrips, planned: plannedTrips },
      openProblems,
      pendingUsers,
      monthly: months,
      people: isAdminUser ? { drivers: driverCount, owners: ownerCount, mechanics: mechanicCount } : undefined
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Small role summary for the Driver and Mechanic home screens
app.get('/api/summary', authenticate, allowRoles('Driver', 'Mechanic'), async (req, res) => {
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    if (req.user.role === 'Driver') {
      const plates = await allowedPlates(req.user);
      const [vehicles, activeTrips, plannedTrips, openReports, fuel] = await Promise.all([
        Vehicle.countDocuments(vehicleScope(req.user)),
        Trip.countDocuments({ driverId: req.user.id, status: { $in: LIVE_TRIP } }),
        Trip.countDocuments({ driverId: req.user.id, status: 'Assigned' }),
        Incident.countDocuments({ reportedById: req.user.id, status: { $ne: 'Resolved' } }),
        Fuel.aggregate([
          { $match: { vehiclePlate: { $in: plates }, date: { $gte: monthStart } } },
          { $group: { _id: null, liters: { $sum: '$liters' } } }
        ])
      ]);
      return res.json({ vehicles, activeTrips, plannedTrips, openReports, fuelLiters: fuel[0]?.liters || 0 });
    }

    const mine = { mechanic: sameName(req.user.name), date: { $gte: monthStart } };
    const [needsRepair, inMaintenance, openProblems, jobs] = await Promise.all([
      Vehicle.countDocuments({ status: 'Needs Repair' }),
      Vehicle.countDocuments({ status: 'In Maintenance' }),
      Incident.countDocuments({ status: { $ne: 'Resolved' } }),
      Maintenance.aggregate([{ $match: mine }, { $group: { _id: null, count: { $sum: 1 }, cost: { $sum: '$cost' } } }])
    ]);
    res.json({ needsRepair, inMaintenance, openProblems, jobsThisMonth: jobs[0]?.count || 0, costThisMonth: jobs[0]?.cost || 0 });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// REPORTS (Admin: whole fleet | Owner: own vehicles)
// ---------------------------------------------------------------------------
app.get('/api/reports', authenticate, allowRoles('Admin', 'Owner'), async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 29 * 86400000);
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Invalid date range' });
    to.setUTCHours(23, 59, 59, 999);
    from.setUTCHours(0, 0, 0, 0);
    if (from > to) return res.status(400).json({ error: '"From" date must be before "To" date' });

    const vehicles = await Vehicle.find(vehicleScope(req.user)).sort({ name: 1 }).lean();
    const inPlates = { vehiclePlate: { $in: vehicles.map(v => v.plateNumber) } };
    const range = (field) => ({ [field]: { $gte: from, $lte: to } });

    const [fuel, maint, trips, problems] = await Promise.all([
      Fuel.aggregate([{ $match: { ...inPlates, ...range('date') } },
        { $group: { _id: '$vehiclePlate', liters: { $sum: '$liters' }, cost: { $sum: '$cost' } } }]),
      Maintenance.aggregate([{ $match: { ...inPlates, ...range('date') } },
        { $group: { _id: '$vehiclePlate', cost: { $sum: '$cost' }, jobs: { $sum: 1 } } }]),
      Trip.aggregate([{ $match: { ...inPlates, status: 'Completed', ...range('completedAt') } },
        { $group: { _id: '$vehiclePlate', trips: { $sum: 1 },
          km: { $sum: { $subtract: [{ $ifNull: ['$endOdometer', 0] }, { $ifNull: ['$startOdometer', 0] }] } } } }]),
      Incident.aggregate([{ $match: { ...inPlates, ...range('createdAt') } },
        { $group: { _id: '$vehiclePlate', count: { $sum: 1 } } }])
    ]);
    const idx = (list) => Object.fromEntries(list.map(x => [x._id, x]));
    const F = idx(fuel), M = idx(maint), T = idx(trips), P = idx(problems);

    const rows = vehicles.map(v => {
      const p = v.plateNumber;
      const row = {
        plateNumber: p, name: v.name, status: v.status, driver: v.assignedDriver,
        trips: T[p]?.trips || 0, km: T[p]?.km || 0,
        fuelLiters: F[p]?.liters || 0, fuelCost: F[p]?.cost || 0,
        maintenanceJobs: M[p]?.jobs || 0, maintenanceCost: M[p]?.cost || 0,
        problems: P[p]?.count || 0
      };
      row.totalCost = row.fuelCost + row.maintenanceCost;
      row.costPerKm = row.km > 0 ? row.totalCost / row.km : null;
      return row;
    });

    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const totals = {
      vehicles: rows.length, trips: sum('trips'), km: sum('km'),
      fuelLiters: sum('fuelLiters'), fuelCost: sum('fuelCost'),
      maintenanceJobs: sum('maintenanceJobs'), maintenanceCost: sum('maintenanceCost'),
      problems: sum('problems'), totalCost: sum('totalCost')
    };
    totals.costPerKm = totals.km > 0 ? totals.totalCost / totals.km : null;

    res.json({ from, to, rows, totals });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = app;
