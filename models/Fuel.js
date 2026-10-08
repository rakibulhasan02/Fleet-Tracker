const mongoose = require('mongoose');

const FuelSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  date: { type: Date, default: Date.now },
  liters: { type: Number, required: true, min: 0.1 },
  cost: { type: Number, required: true, min: 0 },
  odometer: { type: Number, min: 0 },
  station: { type: String, default: '' },
  loggedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Fuel || mongoose.model('Fuel', FuelSchema);