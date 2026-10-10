const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  plateNumber: { type: String, required: true, unique: true },
  model: { type: String, required: true },
  status: {
    type: String,
    // Active = Ready for work. Drivers' problem reports set "Needs Repair";
    // mechanics move it to "In Maintenance" and back to Active (Ready).
    enum: ['Active', 'Needs Repair', 'In Maintenance', 'Out of Service'],
    default: 'Active'
  },
  mileage: { type: Number, default: 0 },
  assignedDriver: { type: String, default: 'Unassigned' },
  assignedDriverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  owner: { type: String, default: 'Unassigned' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Last position reported by the driver's phone during a trip
  location: {
    lat: { type: Number },
    lng: { type: Number },
    updatedAt: { type: Date }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Vehicle || mongoose.model('Vehicle', VehicleSchema);
