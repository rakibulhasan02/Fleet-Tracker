const mongoose = require('mongoose');

// status has NO default on purpose: accounts created before the approval
// feature have no status and are treated as Approved by the API.
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Driver', 'Owner', 'Mechanic'], default: 'Driver' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'] },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
