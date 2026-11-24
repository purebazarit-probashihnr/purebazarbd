import api from './api';

const outletParams = (selectedOutletId) => (
  selectedOutletId ? { params: { selectedOutletId } } : undefined
);

export const scanPosItem = (barcode, selectedOutletId) => api.get(
  `/pos/scan/${encodeURIComponent(barcode)}`,
  outletParams(selectedOutletId),
);
export const searchPosItems = (q, selectedOutletId) => api.get('/pos/search', {
  params: { q, ...(selectedOutletId ? { selectedOutletId } : {}) },
});
export const getPosCatalog = (selectedOutletId) => api.get('/pos/catalog', outletParams(selectedOutletId));
export const previewPosBill = (payload, selectedOutletId) => api.post(
  '/pos/bill', payload, outletParams(selectedOutletId),
);
export const verifyPosMember = (payload) => api.post('/pos/verify-member', payload);
export const checkPosWalletBalance = (payload) => api.post('/shareholders/balance-check', payload);
export const checkoutPosBill = (payload, selectedOutletId) => api.post(
  '/pos/checkout', payload, outletParams(selectedOutletId),
);
export const syncOfflinePosBill = (payload, selectedOutletId) => api.post(
  '/pos/offline-sync', payload, outletParams(selectedOutletId),
);

export function posErrorMessage(error) {
  return error.response?.data?.message || error.message || 'The POS request could not be completed.';
}
