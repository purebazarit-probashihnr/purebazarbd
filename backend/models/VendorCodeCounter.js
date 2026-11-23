const mongoose = require('mongoose');

const vendorCodeCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0, min: 0 },
});

module.exports = mongoose.models.VendorCodeCounter
  || mongoose.model('VendorCodeCounter', vendorCodeCounterSchema);
