import { Router } from 'express';
import { getTips, refreshTips } from '../controllers/tips.controller';

const router = Router();

// GET /api/tips/:uid  -> generates or returns cached AI tips
router.get('/:uid', getTips);

// POST /api/tips/:uid/refresh  -> force-invalidate cache and regenerate
router.post('/:uid/refresh', refreshTips);

export default router;
