const mongoose = require('mongoose');

// Audit trail so the Admin can monitor what is happening in the fleet.
const ActivitySchema = new mongoose.Schema({
  user: { type: String, default: 'System' },
  role: { type: String, default: '' },
  action: { type: String, required: true },
  details: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.models.Activity || mongoose.model('Activity', ActivitySchema);
