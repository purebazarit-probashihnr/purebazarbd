const mongoose = require('mongoose');
const Order = require('../models/Order');

describe('legacy offline wallet order fields', () => {
  it.each(['pending', 'verified', 'mismatch', 'not_found', 'unverifiable'])(
    'continues to load an old order with the %s field value',
    async (walletVerification) => {
      const order = new Order({
        orderNumber: `OFF-${walletVerification}`,
        walletOffline: true,
        walletVerification,
        walletVerificationReason: 'Legacy value',
        walletVerificationCheckedAt: new Date(),
        lines: [{
          productId: new mongoose.Types.ObjectId(),
          productName: 'Item',
          quantity: 1,
          mrp: 10,
          subtotal: 10,
          total: 10,
        }],
        subtotal: 10,
        grandTotal: 10,
        payments: [{ method: 'WALLET', amount: 10 }],
        paymentStatus: 'PAID',
        cashier: new mongoose.Types.ObjectId(),
        outlet: new mongoose.Types.ObjectId(),
      });

      await expect(order.validate()).resolves.toBeUndefined();
    },
  );
});
