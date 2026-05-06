import { Request, Response } from 'express';
import { fetchInsightsForUser } from '../services/insights.service';
import { fetchPredictionForUser } from '../services/prediction.service';

export const getUserDataBundle = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const [insightsResult, predictionResult] = await Promise.allSettled([
            fetchInsightsForUser(uid),
            fetchPredictionForUser(uid),
        ]);

        if (
            insightsResult.status === 'rejected' &&
            !(insightsResult.reason instanceof Error && insightsResult.reason.message.includes('No insights found'))
        ) {
            throw insightsResult.reason;
        }

        if (predictionResult.status === 'rejected') {
            throw predictionResult.reason;
        }

        const insights = insightsResult.status === 'fulfilled' ? insightsResult.value : null;
        const prediction = predictionResult.status === 'fulfilled' ? predictionResult.value : null;

        if (!insights && !prediction) {
            res.status(404).json({ error: 'No insights or prediction found for this user' });
            return;
        }

        res.status(200).json({
            data: {
                uid,
                insights,
                prediction,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';

        console.error('Error fetching user data bundle:', error);
        res.status(500).json({ error: message });
    }
};