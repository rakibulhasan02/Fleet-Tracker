const mongoose = require('mongoose');

const DriverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  licenseNumber: { type: String, required: true, unique: true },
  licenseExpiry: { type: Date, required: true },
  status: { type: String, enum: ['Available', 'On Trip', 'On Leave'], default: 'Available' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Driver || mongoose.model('Driver', DriverSchema);