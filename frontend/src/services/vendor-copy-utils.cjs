function productGroupId(product) {
  return String(product?.productGroupId || product?.id || '');
}

function getExcludedVendorIds(product, products = []) {
  if (!product) return [];
  const groupId = productGroupId(product);
  return [...new Set(products
    .filter((candidate) => productGroupId(candidate) === groupId)
    .map((candidate) => candidate.vendorId)
    .filter(Boolean)
    .map((id) => String(id)))];
}

function findDuplicateVendorMessage(product, products = [], vendorId) {
  if (!vendorId) return '';
  const groupId = productGroupId(product);
  const hasCopy = products.some((candidate) => (
    productGroupId(candidate) === groupId
    && String(candidate.vendorId || '') === String(vendorId)
  ));
  return hasCopy ? 'This vendor already has this product.' : '';
}

module.exports = { productGroupId, getExcludedVendorIds, findDuplicateVendorMessage };
