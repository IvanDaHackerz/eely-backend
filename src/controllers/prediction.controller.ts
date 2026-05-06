import { Request, Response } from 'express';
import { invalidateTipsCache } from '../services/tips.service';
import { fetchApplianceKwh, fetchMeralcoRatePerKwh } from '../services/appliance-enrichment.service';
import {
    addApplianceForUser,
    ApplianceRecord,
    deleteApplianceForUser,
    fetchApplianceRecordForUser,
    fetchApplianceRecordsForUser,
    generatePrediction,
    getPrediction,
} from '../services/prediction.service';

// POST /api/prediction/generate/:uid
// Body: { "latitude": number|null, "longitude": number|null }
// Returns prediction + appliance analysis in a single response
export const triggerPrediction = async (req: Request, res: Response): Promise<void> => {
    try {
        const uid = (req.params.uid || req.body.uid) as string;
        const { latitude, longitude } = req.body;
        if (!uid) { res.status(400).json({ error: 'Missing required field: uid' }); return; }

        console.log(`[Prediction] Generating prediction for uid="${uid}"...`);
        const result = await generatePrediction(uid, latitude ?? null, longitude ?? null);
        console.log(`[Prediction] Done for uid="${uid}".`);

        // Invalidate tips cache so they regenerate with updated predictions
        await invalidateTipsCache(uid);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: error?.message || 'Failed to generate prediction' });
    }
};

// GET /api/prediction/:uid
// Returns cached prediction from Firestore
export const fetchPrediction = async (req: Request, res: Response): Promise<void> => {
    try {
        const uid = req.params.uid as string;
        if (!uid) { res.status(400).json({ error: 'Missing uid parameter' }); return; }

        const data = await getPrediction(uid);
        if (!data) { res.status(404).json({ error: 'No prediction found for this user' }); return; }

        res.status(200).json({ data });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to fetch prediction' });
    }
};

// POST /api/prediction/:uid/appliances
// Body: { "name": string, "kwh": number, "use_duration": number, "is_added": boolean }
// Adds a new appliance document under prediction/{uid}/appliances
export const addAppliance = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;
        const { name, kwh, use_duration, is_added } = req.body;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: name' });
            return;
        }

        const appliance = {
            name,
            kwh: Number(kwh),
            use_duration: Number(use_duration),
            is_added: Boolean(is_added),
        };

        if (Number.isNaN(appliance.kwh) || Number.isNaN(appliance.use_duration)) {
            res.status(400).json({ error: 'Invalid numeric value for kwh or use_duration' });
            return;
        }

        const created = await addApplianceForUser(uid, appliance);
        res.status(201).json({ data: { ...created, id: created._doc_id } });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to add appliance' });
    }
};

// POST /api/prediction/:uid/appliances/ai-add
// Body: { "name": string, "use_duration": number, "is_added"?: boolean }
// Tavily + AI resolves kWh while Meralco rate_per_kwh is fetched from the fixed URL.
// price = kwh * use_duration * rate_per_kwh, then writes to Firestore.
export const addApplianceWithAI = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;
        const { name, use_duration, is_added } = req.body;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        if (!name || typeof name !== 'string' || !name.trim()) {
            res.status(400).json({ error: 'Missing or invalid required field: name' });
            return;
        }

        const duration = Number(use_duration);
        if (Number.isNaN(duration) || duration <= 0 || duration > 24) {
            res.status(400).json({ error: 'use_duration must be greater than 0 and at most 24 (hours per day)' });
            return;
        }

        const addedFlag = typeof is_added === 'boolean' ? is_added : true;

        let kwh: number;
        let ratePerKwh: number;
        try {
            const [kwhExtraction, resolvedRatePerKwh] = await Promise.all([
                fetchApplianceKwh(name.trim()),
                fetchMeralcoRatePerKwh(),
            ]);
            kwh = kwhExtraction.kwh;
            ratePerKwh = resolvedRatePerKwh;
        } catch (lookupErr: any) {
            console.error('[Prediction] AI/rate lookup failed:', lookupErr?.message || lookupErr);
            res.status(502).json({
                error:
                    'Could not complete kWh and rate lookup. Please try again in a moment.',
            });
            return;
        }

        const price = kwh * duration * ratePerKwh;
        const appliance = {
            name: name.trim(),
            kwh,
            use_duration: duration,
            is_added: addedFlag,
            rate_per_kwh: ratePerKwh,
            price,
        };

        const created = await addApplianceForUser(uid, appliance);
        res.status(201).json({ data: { ...created, id: created._doc_id } });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to add appliance with AI' });
    }
};

// GET /api/prediction/:uid/appliances
// Returns all appliance documents for prediction/{uid}/appliances
export const fetchAppliances = async (req: Request, res: Response): Promise<void> => {
    try {
        const uid = req.params.uid as string;
        if (!uid) { res.status(400).json({ error: 'Missing uid parameter' }); return; }

        const records = await fetchApplianceRecordsForUser(uid);
        const data = records.map((r: ApplianceRecord) => ({ ...r, id: r._doc_id }));
        res.status(200).json({ data });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to fetch appliances' });
    }
};

// GET /api/prediction/:uid/appliances/:applianceId
// Returns one appliance document from the subcollection
export const fetchAppliance = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid, applianceId } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        if (!applianceId || typeof applianceId !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: applianceId' });
            return;
        }

        const appliance = await fetchApplianceRecordForUser(uid, applianceId);
        if (!appliance) {
            res.status(404).json({ error: 'Appliance not found' });
            return;
        }

        res.status(200).json({ data: { ...appliance, id: appliance._doc_id } });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to fetch appliance' });
    }
};

// DELETE /api/prediction/:uid/appliances/:applianceId
// Removes a specific appliance document from the subcollection
export const removeAppliance = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid, applianceId } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        if (!applianceId || typeof applianceId !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: applianceId' });
            return;
        }

        const removed = await deleteApplianceForUser(uid, applianceId);
        if (!removed) {
            res.status(404).json({ error: 'Appliance not found' });
            return;
        }

        res.status(200).json({ message: 'Appliance removed successfully' });
    } catch (error: any) {
        console.error('[Prediction] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to remove appliance' });
    }
};
