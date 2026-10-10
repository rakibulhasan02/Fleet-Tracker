const mongoose = require('mongoose');

// A driver's accident / vehicle problem report. Mechanics diagnose and resolve it.
const IncidentSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  type: {
    type: String,
    enum: ['Accident', 'Breakdown', 'Mechanical Problem', 'Electrical Problem', 'Tires / Brakes', 'Other'],
    required: true
  },
  severity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  description: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Reported', 'Diagnosed', 'In Repair', 'Resolved'], default: 'Reported' },
  diagnosis: { type: String, default: '' },
  reportedBy: { type: String, default: '' },
  reportedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedBy: { type: String, default: '' },
  resolvedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Incident || mongoose.model('Incident', IncidentSchema);
