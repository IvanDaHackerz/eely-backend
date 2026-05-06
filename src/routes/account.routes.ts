import { Router } from 'express';
import { createAccount, getAccount } from '../controllers/account.controller';

const router = Router();

// POST /api/accounts
router.post('/', createAccount);

// GET /api/accounts/:uid
router.get('/:uid', getAccount);

export default router;
