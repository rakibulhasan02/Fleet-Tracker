const mongoose = require('mongoose');

const MaintenanceSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  type: {
    type: String,
    enum: ['Oil Change', 'Tire Service', 'Brake Service', 'Inspection', 'Repair', 'Other'],
    required: true
  },
    mechanic: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  cost: { type: Number, default: 0, min: 0 },
  mileageAtService: { type: Number, min: 0 },
  notes: { type: String, default: '' },
  loggedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Maintenance || mongoose.model('Maintenance', MaintenanceSchema);