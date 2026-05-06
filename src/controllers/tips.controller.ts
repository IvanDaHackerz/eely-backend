import { Request, Response } from 'express';
import { generateTips, invalidateTipsCache } from '../services/tips.service';

export const getTips = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const result = await generateTips(uid);

        res.status(200).json({ data: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Error generating tips:', error);
        res.status(500).json({ error: message });
    }
};

/**
 * POST /api/tips/:uid/refresh
 * Force-invalidates the tips cache and regenerates fresh tips.
 */
export const refreshTips = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        // Clear the cache first
        await invalidateTipsCache(uid);

        // Generate fresh tips
        const result = await generateTips(uid);

        res.status(200).json({ data: result, refreshed: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Error refreshing tips:', error);
        res.status(500).json({ error: message });
    }
};
