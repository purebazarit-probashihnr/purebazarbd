const {
  AuditLog, Settings, Vendor, WalletAuditLog,
} = require('../models');
const probashiWalletService = require('../services/probashiWalletService');
const { nextVendorCode } = require('../services/vendorCodeService');

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function getTerms(req, res, next) {
  try {
    const settings = await Settings.findOne({ singleton: 'global' }).lean();
    const now = Date.now();
    const currentTerms = (settings?.vendorTerms || [])
      .filter((term) => new Date(term.effectiveFrom).getTime() <= now)
      .sort((left, right) => new Date(right.effectiveFrom) - new Date(left.effectiveFrom))[0] || null;
    return res.json({
      success: true,
      terms: currentTerms && {
        version: currentTerms.version,
        terms: currentTerms.terms,
        effectiveFrom: currentTerms.effectiveFrom,
      },
    });
  } catch (error) {
    return next(error);
  }
}

function vendorOutput(vendor) {
  const data = vendor.toObject ? vendor.toObject() : vendor;
  const isNonMember = data.membershipType === 'Non-member';
  const memberId = isNonMember ? null : data.memberId || null;
  const vendorCode = data.vendorCode || (isNonMember ? data.memberId : null);
  const membershipType = data.membershipType || (memberId ? 'Probashi member' : 'Non-member');
  return {
    id: data._id.toString(),
    memberId,
    vendorCode,
    identifier: memberId || vendorCode,
    membershipType,
    name: data.name,
    mobile: data.mobile,
    shopName: data.shopName,
    address: data.address,
    productCategory: data.productCategory,
    payoutMethod: data.payoutMethod,
    accountDetails: data.accountDetails,
    termsAccepted: data.termsAccepted,
    termsVersion: data.termsVersion,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

async function list(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.q) {
      const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['memberId', 'vendorCode', 'name', 'mobile', 'shopName', 'productCategory']
        .map((field) => ({ [field]: new RegExp(escaped, 'i') }));
    }
    const vendors = await Vendor.find(filter).sort({ name: 1 }).lean();
    return res.json({ success: true, vendors: vendors.map(vendorOutput) });
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  const suppliedMemberId = String(req.body.memberId || '').trim();
  let member;
  try {
    if (suppliedMemberId) {
      let verified = false;
      try {
        member = await probashiWalletService.verifyMember({ memberId: suppliedMemberId });
        verified = true;
      } finally {
        await WalletAuditLog.create({
          memberId: suppliedMemberId,
          action: 'MEMBER_VERIFY',
          succeeded: verified,
          createdBy: req.user._id,
        });
      }
      if (!member.valid || !member.active || !member.walletEnabled) {
        throw statusError('Member must be valid, active, and wallet-enabled', 403);
      }
    }

    const memberId = suppliedMemberId ? member.memberId : undefined;

    let vendor;
    for (let attempt = 0; ; attempt += 1) {
      const vendorCode = suppliedMemberId ? undefined : await nextVendorCode();
      try {
        [vendor] = await Vendor.create([{
          memberId: memberId || vendorCode,
          ...(vendorCode ? { vendorCode } : {}),
          membershipType: memberId ? 'Probashi member' : 'Non-member',
          name: req.body.name,
          applicantNameBn: req.body.applicantNameBn,
          fatherName: req.body.fatherName,
          motherName: req.body.motherName,
          dateOfBirth: req.body.dateOfBirth,
          nationality: req.body.nationality,
          nidOrPassportNumber: req.body.nidOrPassportNumber,
          presentAddress: req.body.presentAddress,
          permanentAddress: req.body.permanentAddress,
          mobile: req.body.mobile,
          emergencyContact: req.body.emergencyContact,
          email: req.body.email,
          shopName: req.body.shopName,
          tradeLicenseNumber: req.body.tradeLicenseNumber,
          address: req.body.address,
          productCategory: req.body.productCategory,
          payoutMethod: req.body.payoutMethod,
          accountDetails: req.body.accountDetails,
          termsAccepted: req.body.termsAccepted,
          termsVersion: req.body.termsVersion,
          status: 'Active',
        }]);
        break;
      } catch (error) {
        if (error.code !== 11000) throw error;
        if (!memberId && attempt < 4) continue;
        throw statusError(
          memberId ? 'A vendor is already registered for this member' : 'Unable to allocate a unique vendor code',
          409,
        );
      }
    }
    await AuditLog.create({
      actorId: req.user._id,
      action: 'CREATE',
      entity: 'Vendor',
      entityId: vendor._id,
      after: vendor.toObject(),
      ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, vendor: vendorOutput(vendor) });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) throw statusError('Vendor not found', 404);
    const before = vendor.toObject();
    vendor.status = req.body.status;
    await vendor.save();
    await AuditLog.create({
      actorId: req.user._id,
      action: 'UPDATE',
      entity: 'Vendor',
      entityId: vendor._id,
      before,
      after: vendor.toObject(),
      ipAddress: req.ip,
      metadata: { changedFields: ['status'] },
    });
    return res.json({ success: true, vendor: vendorOutput(vendor) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  create,
  getTerms,
  list,
  updateStatus,
};
