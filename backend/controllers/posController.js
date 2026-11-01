const { scanItem, searchItems } = require('../services/posCatalogService');
const { loadBill, billOutput } = require('../services/posBillService');
const posCheckoutService = require('../services/posCheckoutService');

async function buildBill(req, res, next) {
  try {
    const result = await loadBill(req.body, req.user);
    return res.json({ success: true, bill: billOutput(result) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  buildBill,
  finalizeBill: posCheckoutService.finalizeBill,
  scanItem,
  searchItems,
  syncOfflineBill: posCheckoutService.syncOfflineBill,
};
