import { Request, Response } from 'express';
import { generateInsights, getInsights } from '../services/insights.service';
import { invalidateTipsCache } from '../services/tips.service';

// POST /api/insights/generate/:uid
// Body: { "latitude": number|null, "longitude": number|null }
// Triggers AI analysis and returns full result
export const triggerInsights = async (req: Request, res: Response): Promise<void> => {
    try {
        const uid = (req.params.uid || req.body.uid) as string;
        const { latitude, longitude } = req.body;
        if (!uid) { res.status(400).json({ error: 'Missing required field: uid' }); return; }

        console.log(`[Insights] Generating insights for uid="${uid}"...`);
        const result = await generateInsights(uid, latitude ?? null, longitude ?? null);
        console.log(`[Insights] Done for uid="${uid}".`);

        // Invalidate tips cache so they regenerate with updated insights
        await invalidateTipsCache(uid);

        res.status(200).json(result);
    } catch (error: any) {
        console.error('[Insights] Error:', error?.message || error);
        const status = typeof error?.status === 'number' ? error.status : 500;
        const payload: Record<string, unknown> = {
            error: error?.message || 'Failed to generate insights',
        };
        if (error?.code) {
            payload.code = error.code;
        }
        res.status(status).json(payload);
    }
};

// GET /api/insights/:uid
// Returns cached insights from Firestore (no AI call)
export const fetchInsights = async (req: Request, res: Response): Promise<void> => {
    try {
        const uid = req.params.uid as string;
        if (!uid) { res.status(400).json({ error: 'Missing uid parameter' }); return; }

        const data = await getInsights(uid);
        if (!data) { res.status(404).json({ error: 'No insights found for this user' }); return; }

        res.status(200).json({ data });
    } catch (error: any) {
        console.error('[Insights] Error:', error?.message || error);
        res.status(500).json({ error: 'Failed to fetch insights' });
    }
};
import { fetchInsightsForUser, fetchMonthlyReportForUser } from '../services/insights.service';

export const getInsightsDocument = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const insights = await fetchInsightsForUser(uid);

        res.status(200).json({ data: insights });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';

        if (message.includes('No insights found')) {
            res.status(404).json({ error: 'Insights document not found' });
            return;
        }

        console.error('Error fetching insights document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getMonthlyReport = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const monthlyReport = await fetchMonthlyReportForUser(uid);

        res.status(200).json({
            data: monthlyReport,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';

        if (message.includes('No bills found')) {
            res.status(404).json({ error: 'No bills found for this account id' });
            return;
        }

        console.error('Error fetching monthly consumption summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
