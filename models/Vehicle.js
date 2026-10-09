const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  plateNumber: { type: String, required: true, unique: true },
  model: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['Active', 'In Maintenance', 'Out of Service'], 
    default: 'Active' 
  },
  mileage: { type: Number, default: 0 },
  assignedDriver: { type: String, default: 'Unassigned' },
    owner: { type: String, default: 'Unassigned' },
      location: {
    lat: Number,
    lng: Number,
    updatedAt: Date,
    updatedBy: String
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Vehicle || mongoose.model('Vehicle', VehicleSchema);