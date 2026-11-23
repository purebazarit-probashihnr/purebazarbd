jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Order: { findById: jest.fn() },
}));

jest.mock('../services/probashiWalletService', () => ({
  verifyMember: jest.fn(),
  getTransactionReport: jest.fn(),
}));

const { AuditLog, Order } = require('../models');
const probashiWalletService = require('../services/probashiWalletService');
const { verifyOfflineWalletOrder } = require('../services/offlineWalletVerificationService');

function makeOrder() {
  const order = {
    _id: 'order-1',
    walletOffline: true,
    walletMemberId: 'PB-100',
    walletReference: 'TX-100',
    grandTotal: 125,
    soldAt: new Date('2026-03-10T10:00:00.000Z'),
    walletVerification: 'pending',
    toObject() {
      return {
        _id: this._id,
        walletVerification: this.walletVerification,
        walletVerificationReason: this.walletVerificationReason,
      };
    },
    save: jest.fn(async () => order),
  };
  return order;
}

describe('offline wallet verification', () => {
  let order;
  const validMember = {
    memberId: 'PB-100', valid: true, active: true, walletEnabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    order = makeOrder();
    Order.findById.mockResolvedValue(order);
    AuditLog.create.mockResolvedValue({});
    probashiWalletService.verifyMember.mockResolvedValue(validMember);
    probashiWalletService.getTransactionReport.mockResolvedValue({
      transactions: [{ transactionId: 'TX-100', amount: 125, date: '2026-03-10T10:00:00Z' }],
    });
  });

  it('sets verified when Probashi confirms the member and exact reference amount', async () => {
    await verifyOfflineWalletOrder(order._id, { actorId: 'manager-1' });

    expect(order.walletVerification).toBe('verified');
    expect(order.walletVerificationReason).toMatch(/verified/i);
    expect(probashiWalletService.verifyMember).toHaveBeenCalledWith({ memberId: 'PB-100' });
    expect(probashiWalletService.getTransactionReport).toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'manager-1', action: 'WALLET_VERIFY', entity: 'Order',
    }));
  });

  it('sets mismatch when the matching reference has a different amount', async () => {
    probashiWalletService.getTransactionReport.mockResolvedValue({
      transactions: [{ transactionId: 'TX-100', amount: 124, date: '2026-03-10T10:00:00Z' }],
    });

    await verifyOfflineWalletOrder(order._id);

    expect(order.walletVerification).toBe('mismatch');
    expect(order.walletVerificationReason).toMatch(/does not match bill amount/);
  });

  it('sets not_found when the report has no transaction reference', async () => {
    probashiWalletService.getTransactionReport.mockResolvedValue({ transactions: [] });

    await verifyOfflineWalletOrder(order._id);

    expect(order.walletVerification).toBe('not_found');
    expect(order.walletVerificationReason).toMatch(/No matching Probashi transaction/);
  });

  it('keeps the bill pending with a reason when Probashi is unreachable', async () => {
    probashiWalletService.getTransactionReport.mockRejectedValue(new Error('service unavailable'));

    await verifyOfflineWalletOrder(order._id);

    expect(order.walletVerification).toBe('pending');
    expect(order.walletVerificationReason).toMatch(/Verification unavailable: service unavailable/);
    expect(order.save).toHaveBeenCalled();
  });
});
