import * as service from '../services/treatmentPayments.service.js';
const handle = fn => async (req, res) => {
  try { const result = await fn(req); res.status(req.method === 'POST' && !req.params.id ? 201 : 200).json({ success: true, data: result }); }
  catch (error) { console.error('Simple payment error:', error); res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Internal server error' }); }
};
export const createPayment = handle(req => service.createPayment(req.body));
export const listPayments = handle(() => service.listPayments());
export const getPayment = handle(req => service.getPayment(req.params.id));
export const addInstallment = handle(req => service.addInstallment(req.params.id, req.body));
export const paymentSummary = handle(() => service.paymentSummary());
