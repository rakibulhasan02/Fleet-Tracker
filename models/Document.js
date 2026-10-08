const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  title: { type: String, required: true },
  documentType: { type: String, enum: ['Insurance', 'Registration', 'Permit', 'Inspection'], required: true },
  expiryDate: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
}, { id: false });

function computeDaysLeft(expiryDate) {
  return Math.ceil((new Date(expiryDate) - Date.now()) / 86400000);
}

function computeStatus(expiryDate) {
  const days = computeDaysLeft(expiryDate);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring Soon';
  return 'Valid';
}

DocumentSchema.virtual('daysLeft').get(function () { return computeDaysLeft(this.expiryDate); });
DocumentSchema.virtual('status').get(function () { return computeStatus(this.expiryDate); });
DocumentSchema.statics.computeStatus = computeStatus;
DocumentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.Document || mongoose.model('Document', DocumentSchema);