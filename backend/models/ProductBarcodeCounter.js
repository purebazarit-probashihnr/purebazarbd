const mongoose = require('mongoose');

const productBarcodeCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0, min: 0 },
});

module.exports = mongoose.models.ProductBarcodeCounter
  || mongoose.model('ProductBarcodeCounter', productBarcodeCounterSchema);
