import { Router } from 'express';
import { createBill, deleteBill, getBillsByUid, enrichBill } from '../controllers/bills.controller';

const router = Router();

// GET /api/bills/:uid
router.get('/:uid', getBillsByUid);

// POST /api/bills
router.post('/', createBill);

// POST /api/bills/enrich/:billId
router.post('/enrich/:billId', enrichBill);

// DELETE /api/bills/:docId
router.delete('/:docId', deleteBill);

export default router;
