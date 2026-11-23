import api from './api';

const outletParams = (selectedOutletId) => (
  selectedOutletId ? { params: { selectedOutletId } } : undefined
);

export const getSalesHistory = (params) => api.get('/pos/history', { params });
export const auditPosReceiptReprint = (orderId, selectedOutletId) => api.post(
  `/pos/${orderId}/receipt`, {}, outletParams(selectedOutletId),
);
export const returnPosOrder = (orderId, payload, selectedOutletId) => api.post(
  `/pos/${orderId}/return`, payload, outletParams(selectedOutletId),
);
export const getCurrentPosShift = (selectedOutletId) => api.get(
  '/pos/shifts/current', outletParams(selectedOutletId),
);
export const getPosShiftReport = (shiftId, selectedOutletId) => api.get(
  `/pos/shifts/${shiftId}/report`, outletParams(selectedOutletId),
);
export const openPosShift = (payload, selectedOutletId) => api.post(
  '/pos/shifts', payload, outletParams(selectedOutletId),
);
export const closePosShift = (shiftId, payload, selectedOutletId) => api.post(
  `/pos/shifts/${shiftId}/close`, payload, outletParams(selectedOutletId),
);
