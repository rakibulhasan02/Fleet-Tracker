const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  title: { type: String, required: true }, // e.g. Insurance Policy, Vehicle Tax
  documentType: { type: String, enum: ['Insurance', 'Registration', 'Permit', 'Inspection'], required: true },
  expiryDate: { type: Date, required: true },
  status: { type: String, enum: ['Valid', 'Expiring Soon', 'Expired'], default: 'Valid' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Document || mongoose.model('Document', DocumentSchema);