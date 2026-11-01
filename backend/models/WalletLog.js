const mongoose = require('mongoose');

const walletLogSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shareholder' },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  amount: { type: Number, required: true, min: 0.01 },
  type: { type: String, enum: ['DEBIT', 'REFUND'], required: true },
  discountAmount: { type: Number, min: 0 },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  outlet: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
}, { timestamps: true });

walletLogSchema.index({ memberId: 1 });
walletLogSchema.index({ createdAt: 1 });

module.exports = mongoose.models.WalletLog || mongoose.model('WalletLog', walletLogSchema);