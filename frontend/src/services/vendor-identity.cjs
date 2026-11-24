function vendorIdentifier(vendor = {}) {
  return String(vendor.memberId || vendor.vendorCode || '');
}

function vendorLabel(vendor) {
  return `${vendor.name} - ${vendor.shopName || 'No shop'} (${vendorIdentifier(vendor)})`;
}

function matchesVendor(vendor, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return true;
  return [vendor.name, vendor.shopName, vendor.mobile, vendor.memberId, vendor.vendorCode]
    .some((value) => String(value || '').toLowerCase().includes(term));
}

module.exports = { matchesVendor, vendorIdentifier, vendorLabel };
