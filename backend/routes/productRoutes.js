const express = require('express');
const { body, param } = require('express-validator');
const productsController = require('../controllers/productsController');
const authMiddleware = require('../middlewares/authMiddleware');
const authorizeMiddleware = require('../middlewares/authorizeMiddleware');
const validateRequest = require('../middlewares/validateRequest');

const router = express.Router();
const read = [authMiddleware, authorizeMiddleware({ permissions: ['products:read'] })];
const write = [authMiddleware, authorizeMiddleware({ permissions: ['products:write'] })];
const id = param('id').isMongoId().withMessage('A valid product ID is required');
const name = body('name').isString().trim().isLength({ min: 1, max: 150 })
  .withMessage('Name must be 1 to 150 characters');
const sku = body('sku').optional({ nullable: true }).isString().trim().isLength({ max: 100 })
  .withMessage('SKU must be at most 100 characters');
const categoryId = body('categoryId').isMongoId().withMessage('A valid category ID is required');
const unitId = body('unitId').isMongoId().withMessage('A valid unit ID is required');
const ownerType = body('ownerType').isIn(['COMPANY', 'VENDOR']).withMessage('Owner type must be COMPANY or VENDOR');
const vendorPrice = body('vendorPrice').isFloat({ min: 0 }).toFloat()
  .withMessage('Vendor price must be zero or greater');
const mrp = body('mrp').isFloat({ min: 0 }).toFloat()
  .withMessage('MRP must be zero or greater')
  .custom((value, { req }) => (
    req.body.vendorPrice === undefined || value >= Number(req.body.vendorPrice)
  )).withMessage('MRP must be greater than or equal to vendor price');
const optionalId = (field) => body(field).optional({ nullable: true }).isMongoId()
  .withMessage(`${field} must be a valid ID`);
const optionalPrice = (field) => body(field).optional().isFloat({ min: 0 }).toFloat()
  .withMessage(`${field} must be zero or greater`);
const barcode = body('barcode').optional({ nullable: true }).isString().trim().isLength({ max: 100 })
  .withMessage('Barcode must be at most 100 characters');
const barcodes = [
  body('barcodes').optional().isArray({ max: 20 }).withMessage('Enter at most 20 extra barcodes'),
  body('barcodes.*').optional().isString().trim().isLength({ min: 1, max: 100 })
    .withMessage('Each extra barcode must be 1 to 100 characters'),
];

const pieceRules = [
  body('unitsPerPackage').optional({ nullable: true }).isInt({ min: 1 }).toInt()
    .withMessage('unitsPerPackage must be a whole number of 1 or more'),
  body('subUnitPriceOverride').optional({ nullable: true }).isFloat({ min: 0 }).toFloat()
    .withMessage('subUnitPriceOverride must be zero or greater'),
];
const rejectStockUpdate = body().custom((value) => (
  !Object.keys(value || {}).some((field) => /stock|quantity/i.test(field))
)).withMessage('Stock quantities cannot be changed through product updates');

router.get('/', read, productsController.listProducts);
router.get('/barcodes/:barcode', read, [
  param('barcode').isString().trim().isLength({ min: 1, max: 100 }),
], validateRequest, productsController.findBarcodeMatches);
router.post('/:id/add-vendor', write, [
  id,
  body('vendorId').isMongoId().withMessage('A valid vendor ID is required'),
  vendorPrice,
  mrp,
], validateRequest, productsController.addVendorCopy);
router.post('/', write, [
  name, sku, categoryId, unitId, ownerType, vendorPrice, mrp,
  optionalId('brandId'), optionalId('vendorId'),
  barcode, ...barcodes,
  body('barcodeSource').optional().isIn(['manufacturer', 'internal'])
    .withMessage('barcodeSource must be manufacturer or internal'),
  body('vatApplicable').optional().isBoolean().toBoolean()
    .withMessage('vatApplicable must be a boolean'),
  optionalPrice('vatRate').custom((value) => value === undefined || value <= 100)
    .withMessage('vatRate must be between 0 and 100'),
  ...pieceRules,
], validateRequest, productsController.createProduct);
router.get('/:id', read, [id], validateRequest, productsController.getProduct);
router.put('/:id', write, [
  id,
  rejectStockUpdate,
  body('name').optional().isString().trim().isLength({ min: 1, max: 150 })
    .withMessage('Name must be 1 to 150 characters'),
  sku,
  body('categoryId').optional().isMongoId().withMessage('A valid category ID is required'),
  body('unitId').optional().isMongoId().withMessage('A valid unit ID is required'),
  barcode,
  ...barcodes,
  body('barcodeSource').optional().isIn(['manufacturer', 'internal'])
    .withMessage('barcodeSource must be manufacturer or internal'),
  body('ownerType').optional().isIn(['COMPANY', 'VENDOR'])
    .withMessage('Owner type must be COMPANY or VENDOR'),
  optionalPrice('vendorPrice'),
  optionalPrice('mrp').custom((value, { req }) => (
    value === undefined || req.body.vendorPrice === undefined || value >= Number(req.body.vendorPrice)
  )).withMessage('MRP must be greater than or equal to vendor price'),
  optionalId('brandId'), optionalId('vendorId'), optionalPrice('unitValue'),
  body('vatApplicable').optional().isBoolean().toBoolean()
    .withMessage('vatApplicable must be a boolean'),
  optionalPrice('vatRate').custom((value) => value === undefined || value <= 100)
    .withMessage('vatRate must be between 0 and 100'),
  ...pieceRules,
  body('reason').optional().isString().trim().isLength({ min: 1, max: 500 })
    .withMessage('Reason must be 1 to 500 characters'),
], validateRequest, productsController.updateProduct);

module.exports = router;
