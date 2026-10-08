const mongoose = require('mongoose');

const MechanicSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  specialty: { type: String, enum: ['General', 'Engine', 'Electrical', 'Brakes', 'Tires', 'Body Work'], default: 'General' },
  workshop: { type: String, default: '' },
  hourlyRate: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Mechanic || mongoose.model('Mechanic', MechanicSchema);