const mongoose = require('mongoose');
const { calculateSubUnitPrice, effectiveSubUnitPrice } = require('../utils/piecePricing');
const ProductBarcodeCounter = require('./ProductBarcodeCounter');
const { generateUniqueInternalBarcode, normalizeBarcodes } = require('../utils/productBarcodes');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  unitValue: { type: Number, min: 0 },
  ownerType: { type: String, enum: ['COMPANY', 'VENDOR'], required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  productGroupId: { type: mongoose.Schema.Types.ObjectId, default: function groupProduct() { return this._id; } },
  vendorPrice: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  margin: { type: Number, min: 0 },
  unitsPerPackage: { type: Number, min: 1, validate: { validator: Number.isInteger, message: 'Units per package must be a whole number' } },
  subUnitPriceOverride: { type: Number, min: 0 },
  subUnitPrice: { type: Number, min: 0 },
  vatApplicable: { type: Boolean, default: false },
  vatRate: { type: Number, min: 0, max: 100 },
  sku: { type: String, trim: true },
  barcode: { type: String, trim: true, maxlength: 100 },
  barcodes: { type: [String], default: [] },
  barcodeSource: { type: String, enum: ['manufacturer', 'internal'] },
  barcodeKeys: { type: [String], select: false },
  listedOnline: { type: Boolean, default: false },
}, { timestamps: true });

productSchema.pre('validate', async function calculateMargin() {
  if (!this.barcode) {
    this.barcode = await generateUniqueInternalBarcode(this.constructor, ProductBarcodeCounter);
    this.barcodeSource = 'internal';
  } else if (!this.barcodeSource) {
    this.barcodeSource = this.barcode.startsWith('PB') ? 'internal' : 'manufacturer';
  }
  this.barcodes = normalizeBarcodes(this.barcode, this.barcodes)
    .filter((barcode) => barcode !== this.barcode);
  this.barcodeKeys = normalizeBarcodes(this.barcode, this.barcodes);
  if (!this.productGroupId) this.productGroupId = this._id;
  if (Number.isFinite(this.mrp) && Number.isFinite(this.vendorPrice)) {
    this.margin = Math.round((this.mrp - this.vendorPrice + Number.EPSILON) * 100) / 100;
  }
  if (this.unitsPerPackage > 1 && Number.isFinite(this.mrp)) {
    const floor = calculateSubUnitPrice(this.mrp, this.unitsPerPackage);
    if (Number.isFinite(this.subUnitPriceOverride) && this.subUnitPriceOverride < floor) {
      this.invalidate('subUnitPriceOverride', `Piece price cannot be below the margin-safe price of ${floor.toFixed(2)}`);
    }
    this.subUnitPrice = effectiveSubUnitPrice(this);
  } else {
    this.subUnitPrice = undefined;
    this.subUnitPriceOverride = undefined;
  }
  if (this.ownerType === 'VENDOR' && !this.vendorId) {
    this.invalidate('vendorId', 'Vendor-owned products require a vendor');
  }
});

productSchema.path('mrp').validate(function validateMrp(value) {
  return !Number.isFinite(this.vendorPrice) || value >= this.vendorPrice;
}, 'MRP must be greater than or equal to vendor price');

productSchema.index(
  { ownerType: 1, vendorId: 1, barcodeKeys: 1 },
  {
    unique: true,
    name: 'product_owner_vendor_barcode_unique',
    partialFilterExpression: { barcodeKeys: { $exists: true } },
  },
);
productSchema.index({ vendorId: 1 });
productSchema.index({ createdAt: 1 });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);