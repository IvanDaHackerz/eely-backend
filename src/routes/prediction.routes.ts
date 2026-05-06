import { Router } from 'express';
import {
	addAppliance,
	addApplianceWithAI,
	fetchAppliance,
	fetchAppliances,
	fetchPrediction,
	removeAppliance,
	triggerPrediction,
} from '../controllers/prediction.controller';

const router = Router();

// POST /api/prediction/generate     -> triggers AI prediction + appliance analysis (legacy body uid)
router.post('/generate', triggerPrediction);

// POST /api/prediction/generate/:uid -> triggers AI prediction + appliance analysis with uid in the path
router.post('/generate/:uid', triggerPrediction);

// GET /api/prediction/:uid          -> fetches cached prediction from Firestore
router.get('/:uid', fetchPrediction);

// POST /api/prediction/:uid/appliances -> adds a new appliance document
router.post('/:uid/appliances', addAppliance);

// POST /api/prediction/:uid/appliances/ai-add -> Tavily + AI kWh, then save with price
router.post('/:uid/appliances/ai-add', addApplianceWithAI);

// GET /api/prediction/:uid/appliances -> fetches all appliances for the user
router.get('/:uid/appliances', fetchAppliances);

// GET /api/prediction/:uid/appliances/:applianceId -> fetches one appliance
router.get('/:uid/appliances/:applianceId', fetchAppliance);

// DELETE /api/prediction/:uid/appliances/:applianceId -> removes one appliance
router.delete('/:uid/appliances/:applianceId', removeAppliance);

export default router;
