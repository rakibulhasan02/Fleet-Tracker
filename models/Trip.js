const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  vehiclePlate: { type: String, required: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  driverName: { type: String, default: '' },
  origin: { type: String, required: true, trim: true },
  destination: { type: String, required: true, trim: true },
  purpose: { type: String, default: '' },
  status: {
    type: String,
    enum: ['Assigned', 'In Progress', 'Delayed', 'Completed', 'Cancelled'],
    default: 'Assigned'
  },
  startOdometer: { type: Number, min: 0 },
  endOdometer: { type: Number, min: 0 },
  startedAt: { type: Date },
  completedAt: { type: Date },
  notes: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { id: false });

TripSchema.virtual('distance').get(function () {
  return this.endOdometer != null && this.startOdometer != null ? this.endOdometer - this.startOdometer : null;
});
TripSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.Trip || mongoose.model('Trip', TripSchema);
