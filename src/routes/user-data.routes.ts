import { Router } from 'express';
import { getUserDataBundle } from '../controllers/user-data.controller';

const router = Router();

// GET /api/user-data/:uid -> fetches cached insights + prediction docs for a user
router.get('/:uid', getUserDataBundle);

export default router;