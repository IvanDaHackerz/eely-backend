import { Router } from 'express';
import { extractText, analyzeText } from '../controllers/ocr.controller';

const router = Router();

// POST /api/ocr
router.post('/', extractText);

// POST /api/ocr/analyze
router.post('/analyze', analyzeText);

export default router;
