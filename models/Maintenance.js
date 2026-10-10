const mongoose = require('mongoose');

const PartSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, default: 1, min: 1 },
  unitCost: { type: Number, default: 0, min: 0 }
}, { _id: false });

const MaintenanceSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  type: {
    type: String,
    enum: ['Oil Change', 'Tire Service', 'Brake Service', 'Inspection', 'Repair', 'Other'],
    required: true
  },
  mechanic: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  // cost = laborCost + sum(parts). laborCost has no default so older records
  // (which only have `cost`) can be told apart.
  laborCost: { type: Number, min: 0 },
  parts: { type: [PartSchema], default: [] },
  cost: { type: Number, default: 0, min: 0 },
  mileageAtService: { type: Number, min: 0 },
  notes: { type: String, default: '' },
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
  loggedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Maintenance || mongoose.model('Maintenance', MaintenanceSchema);
