import { Router } from 'express';
import {
	triggerInsights,
	getInsightsDocument,
	getMonthlyReport,
} from '../controllers/insights.controller';

const router = Router();

// POST /api/insights/generate  -> triggers AI analysis (legacy body uid)
router.post('/generate', triggerInsights);

// POST /api/insights/generate/:uid -> triggers AI analysis with uid in the path
router.post('/generate/:uid', triggerInsights);

// GET /api/insights/:uid       -> fetches cached insights from Firestore
router.get('/:uid', getInsightsDocument);

// GET /api/insights/:uid/monthly-report
router.get('/:uid/monthly-report', getMonthlyReport);

// Backward-compatible alias
router.get('/:uid/monthly-consumption', getMonthlyReport);

export default router;
