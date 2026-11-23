const express = require('express');
const { body, param, query } = require('express-validator');
const goodsReceiveController = require('../controllers/goodsReceiveController');
const locationRoutes = require('./locationRoutes');
const stockController = require('../controllers/stockController');
const stockTransferController = require('../controllers/stockTransferController');
const stockTransferChallanController = require('../controllers/stockTransferChallanController');
const stockAdjustmentController = require('../controllers/stockAdjustmentController');
const stockCountController = require('../controllers/stockCountController');
const authMiddleware = require('../middlewares/authMiddleware');
const authorizeMiddleware = require('../middlewares/authorizeMiddleware');
const enforceLocationScope = require('../middlewares/enforceLocationScope');
const validateRequest = require('../middlewares/validateRequest');

const router = express.Router();
router.use(locationRoutes);
const read = [authMiddleware, authorizeMiddleware({ permissions: ['stock:read'] })];
const write = [authMiddleware, authorizeMiddleware({ permissions: ['stock:write'] })];
const scopedRead = [...read, enforceLocationScope];
const scopedWrite = [...write, enforceLocationScope];
const id = param('id').isMongoId().withMessage('A valid goods receive ID is required');
const lines = body('lines').isArray({ min: 1 }).withMessage('At least one product line is required');
const lineProduct = body('lines.*.productId').isMongoId().withMessage('A valid product ID is required');
const lineQuantity = (field, min) => body(`lines.*.${field}`).isFloat({ min }).toFloat()
  .withMessage(`${field} must be ${min === 0 ? 'zero or greater' : 'greater than zero'}`);
const lineQuantities = body('lines').custom((items) => (
  Array.isArray(items) && items.every((item) => (
    Number(item.acceptedQuantity) + Number(item.rejectedQuantity) <= Number(item.receivedQuantity)
  ))
)).withMessage('Accepted and rejected quantities cannot exceed received quantity');
const vendorId = body('vendorId').optional({ nullable: true }).isMongoId()
  .withMessage('A valid vendor ID is required');
const challan = body('vendorChallanNumber').optional({ nullable: true }).isString().trim().isLength({ max: 100 })
  .withMessage('Challan number must be at most 100 characters');
const transferId = param('id').isMongoId().withMessage('A valid stock transfer ID is required');
const transferLines = body('lines').isArray({ min: 1 }).withMessage('At least one product line is required');
const transferProduct = body('lines.*.productId').isMongoId().withMessage('A valid product ID is required');
const adjustmentId = param('id').isMongoId().withMessage('A valid stock adjustment ID is required');
const countId = param('id').isMongoId().withMessage('A valid stock count ID is required');
const adjustmentLines = body('lines').isArray({ min: 1 }).withMessage('At least one adjustment line is required');
const adjustmentProducts = body('lines.*.productId').isMongoId().withMessage('A valid product ID is required');
const adjustmentMode = body('mode').isIn(['ADD', 'REMOVE'])
  .withMessage('Adjustment mode must be ADD or REMOVE');
const adjustmentReason = body('reason').isIn([
  'Damaged', 'Expired', 'Lost or stolen', 'Found extra stock', 'Data entry correction', 'Other',
]).withMessage('Choose a valid stock adjustment reason');
const adjustmentReasonMode = body('reason').custom((reason, { req }) => {
  const mode = req.body.mode;
  if (['Damaged', 'Expired', 'Lost or stolen'].includes(reason) && mode !== 'REMOVE') return false;
  if (reason === 'Found extra stock' && mode !== 'ADD') return false;
  return true;
}).withMessage('This reason does not match the selected adjustment mode');
const adjustmentReasonNote = body('reasonNote')
  .if(body('reason').equals('Other'))
  .isString().trim().isLength({ min: 1, max: 500 })
  .withMessage('An Other reason note of 1 to 500 characters is required');
const adjustmentQuantities = body('lines.*.quantity').isFloat({ min: 0.000001 }).toFloat()
  .withMessage('Adjustment quantities must be greater than zero');
const nonZeroAdjustmentLines = body('lines').custom((items) => (
  Array.isArray(items) && items.some((item) => Number(item.quantity) !== 0)
)).withMessage('At least one non-zero adjustment line is required');
const countLines = body('lines').isArray({ min: 1 }).withMessage('At least one stock count line is required');
const countProducts = body('lines.*.productId').isMongoId().withMessage('A valid product ID is required');
const countQuantities = body('lines.*.countedQuantity').isFloat({ min: 0 }).toFloat()
  .withMessage('Counted quantity must be zero or greater');
const stockLocation = body('warehouseId').isMongoId().withMessage('A valid warehouse or outlet ID is required');
const stockReason = body('reason').isString().trim().isLength({ min: 1, max: 500 })
  .withMessage('A reason of 1 to 500 characters is required');
const adminApproval = [authMiddleware, authorizeMiddleware({ roles: ['Super Admin'] })];

router.get('/stock', [...read, enforceLocationScope.forStockRead], [
  query('warehouseId').isMongoId().withMessage('A valid warehouse ID is required'),
], validateRequest, stockController.getWarehouseStock);
router.get('/stock/central-warehouse', [...read, enforceLocationScope.forStockRead], stockController.getCentralWarehouseStock);
router.get('/inventory/outlet-products', [...read, enforceLocationScope.forStockRead], [
  query('warehouseId').optional().isMongoId().withMessage('A valid warehouse or outlet ID is required'),
  query('allLocations').optional().isBoolean().withMessage('allLocations must be true or false'),
], validateRequest, stockController.getOutletProducts);
router.get('/stock-adjustments', [...read, enforceLocationScope], [
  query('selectedOutletId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid location ID is required'),
  query('warehouseId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid warehouse or outlet ID is required'),
  query('status').optional().isIn(['Draft', 'Pending', 'Approved', 'Rejected'])
    .withMessage('A valid adjustment status is required'),
], validateRequest, stockAdjustmentController.listAdjustments);
router.post('/stock-adjustments', [...write, enforceLocationScope], [
  stockLocation,
  stockReason,
  adjustmentMode,
  adjustmentReason,
  adjustmentReasonMode,
  adjustmentReasonNote,
  adjustmentLines,
  adjustmentProducts,
  adjustmentQuantities,
  nonZeroAdjustmentLines,
], validateRequest, stockAdjustmentController.createAdjustment);
router.post('/stock-adjustments/:id/approve', adminApproval, [
  adjustmentId,
], validateRequest, stockAdjustmentController.approveAdjustment);
router.post('/stock-adjustments/:id/reject', adminApproval, [
  adjustmentId,
], validateRequest, stockAdjustmentController.rejectAdjustment);
router.get('/stock-counts', scopedRead, [
  query('selectedOutletId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid location ID is required'),
  query('warehouseId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid warehouse or outlet ID is required'),
  query('status').optional().isIn(['Draft', 'Counting', 'PendingApproval', 'Posted', 'Rejected'])
    .withMessage('A valid stock count status is required'),
], validateRequest, stockCountController.listCounts);
router.post('/stock-counts', [...write, enforceLocationScope.forStockCounts], [
  stockLocation,
  stockReason,
  countLines,
  countProducts,
  countQuantities,
], validateRequest, stockCountController.createCount);
router.post('/stock-counts/:id/post', [...write, enforceLocationScope.forStockCounts], [
  countId,
], validateRequest, stockCountController.postCount);
router.get('/stock-transfers', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:read'] }),
  query('selectedOutletId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid location ID is required'),
  query('status').optional().isIn(['Requested', 'Dispatched', 'Received', 'Discrepancy'])
    .withMessage('A valid transfer status is required'),
], validateRequest, stockTransferController.listTransfers);
router.post('/stock-transfers', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:write'] }),
  body('fromWarehouseId').isMongoId().withMessage('A valid source warehouse ID is required'),
  body('toWarehouseId').isMongoId().withMessage('A valid destination outlet ID is required'),
  transferLines,
  transferProduct,
  body('lines.*.requestedQuantity').isInt({ min: 1 }).toInt()
    .withMessage('Requested quantity must be a positive whole number'),
], validateRequest, stockTransferController.createTransfer);
router.get('/stock-transfers/:id', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:read'] }),
  transferId,
], validateRequest, stockTransferController.getTransfer);
router.get('/stock-transfers/:id/challan', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:read'] }),
  transferId,
], validateRequest, stockTransferChallanController.getTransferChallan);
router.post('/stock-transfers/:id/challan/print', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:read'] }),
  transferId,
], validateRequest, stockTransferChallanController.printTransferChallan);
router.post('/stock-transfers/:id/dispatch', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:write'] }),
  transferId,
  transferLines,
  transferProduct,
  body('lines.*.dispatchedQuantity').isFloat({ min: 0 }).toFloat()
    .withMessage('Dispatched quantity must be zero or greater'),
  body('carrierName').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('Carrier name is required and must be at most 120 characters'),
  body('carrierPhone').isString().trim().isLength({ min: 1, max: 40 })
    .withMessage('Carrier phone is required and must be at most 40 characters'),
  body('vehicle').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 })
    .withMessage('Vehicle must be at most 120 characters'),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 })
    .withMessage('Notes must be at most 500 characters'),
], validateRequest, stockTransferController.dispatchTransfer);
router.post('/stock-transfers/:id/receive', [
  authMiddleware, enforceLocationScope, authorizeMiddleware({ permissions: ['stock:transfer:receive'] }),
  transferId,
  transferLines,
  transferProduct,
  body('lines.*.receivedQuantity').isFloat({ min: 0 }).toFloat()
    .withMessage('Received quantity must be zero or greater'),
], validateRequest, stockTransferController.receiveTransfer);
router.get('/stock/products', scopedRead, [
  query('ownerType').optional().isIn(['COMPANY', 'VENDOR']).withMessage('Owner type must be COMPANY or VENDOR'),
  query('vendorId').if(query('ownerType').equals('VENDOR')).isMongoId()
    .withMessage('Vendor purchases require a valid vendor ID'),
  query('q').optional().isString().trim().isLength({ max: 100 }).withMessage('Search must be at most 100 characters'),
  query('warehouseId').optional().isMongoId().withMessage('A valid warehouse or outlet ID is required'),
  query('mode').if(query('warehouseId').exists()).isIn(['ADD', 'REMOVE'])
    .withMessage('A valid adjustment mode is required'),
  query('q').custom((value, { req }) => !req.query.warehouseId || (typeof value === 'string' && value.trim().length > 0))
    .withMessage('A search term is required for adjustment product search'),
  query('limit').optional().isInt({ min: 1, max: 10 }).withMessage('Product search limit must be between 1 and 10'),
], validateRequest, goodsReceiveController.searchProducts);
router.get('/stock/vendors', read, goodsReceiveController.listVendors);
router.get('/stock/vendors/:id/next-challan', read, [
  param('id').isMongoId().withMessage('A valid vendor ID is required'),
], validateRequest, goodsReceiveController.nextChallanNumber);
router.get('/goods-receives', scopedRead, [
  query('selectedOutletId').optional({ values: 'falsy' }).isMongoId()
    .withMessage('A valid location ID is required'),
], validateRequest, goodsReceiveController.listGoodsReceives);
router.post('/goods-receives', scopedWrite, [
  body('ownerType').isIn(['COMPANY', 'VENDOR']).withMessage('Owner type must be COMPANY or VENDOR'),
  vendorId,
  body('warehouseId').isMongoId().withMessage('A valid warehouse ID is required'),
  challan,
  lines, lineProduct,
  lineQuantity('receivedQuantity', 0.000001),
  lineQuantity('acceptedQuantity', 0),
  lineQuantity('rejectedQuantity', 0),
  lineQuantities,
], validateRequest, goodsReceiveController.createGoodsReceive);
router.post('/goods-receives/vendor-copy', scopedWrite, [
  body('sourceProductId').isMongoId().withMessage('A valid source product ID is required'),
  body('vendorId').isMongoId().withMessage('A valid vendor ID is required'),
  body('vendorPrice').isFloat({ min: 0 }).toFloat().withMessage('Vendor price must be zero or greater'),
  body('mrp').isFloat({ min: 0 }).toFloat().custom((value, { req }) => value >= Number(req.body.vendorPrice))
    .withMessage('MRP must be greater than or equal to vendor price'),
], validateRequest, goodsReceiveController.createReceiveVendorCopy);
router.get('/goods-receives/:id', scopedRead, [id], validateRequest, goodsReceiveController.getGoodsReceive);
router.get('/goods-receives/:id/print', scopedRead, [id], validateRequest, goodsReceiveController.getGoodsReceive);
router.put('/goods-receives/:id', scopedWrite, [
  id,
  body('ownerType').optional().isIn(['COMPANY', 'VENDOR']).withMessage('Owner type must be COMPANY or VENDOR'),
  vendorId,
  body('warehouseId').optional().isMongoId().withMessage('A valid warehouse ID is required'),
  challan,
  body('lines').optional().isArray({ min: 1 }).withMessage('At least one product line is required'),
  lineProduct.optional(),
  lineQuantity('receivedQuantity', 0.000001).optional(),
  lineQuantity('acceptedQuantity', 0).optional(),
  lineQuantity('rejectedQuantity', 0).optional(),
  body('lines').optional().custom((items) => items.every((item) => (
    Number(item.acceptedQuantity) + Number(item.rejectedQuantity) <= Number(item.receivedQuantity)
  ))).withMessage('Accepted and rejected quantities cannot exceed received quantity'),
], validateRequest, goodsReceiveController.updateGoodsReceive);
router.post('/goods-receives/:id/approve', scopedWrite, [id], validateRequest, goodsReceiveController.approveGoodsReceive);
router.post('/goods-receives/:id/reject', scopedWrite, [id], validateRequest, goodsReceiveController.rejectGoodsReceive);

module.exports = router;
