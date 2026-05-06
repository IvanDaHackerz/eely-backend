import { Request, Response } from 'express';
import { ai, AI_MODEL } from '../config/gemini';
import { fetchInsightsForUser } from '../services/insights.service';
import { fetchPredictionForUser, fetchAppliancesForUser } from '../services/prediction.service';

const SYSTEM_INSTRUCTION =
    'You are Eely, a helpful AI assistant for a utility bill management app. ' +
    'You help users understand their electricity bills, consumption patterns, ' +
    'appliance usage, and provide energy-saving tips. Keep responses concise and friendly.\n\n' +
    '⚠️ IMPORTANT LIMITATIONS:\n' +
    '- You CANNOT search the web or access real-time information\n' +
    '- You CANNOT provide current energy prices, weather, or news unless already in the user data\n' +
    '- If asked about information you don\'t have, clearly state you cannot access that information\n' +
    '- Never make up or hallucinate data - only use information provided in the user context\n\n' +
    '💡 TOKEN EFFICIENCY:\n' +
    '- Keep responses concise (2-3 paragraphs maximum)\n' +
    '- Use bullet points for lists\n' +
    '- Avoid repeating information already stated\n' +
    '- Focus on actionable insights rather than lengthy explanations';

// Maximum number of history messages to send (saves tokens)
const MAX_HISTORY_MESSAGES = 10;

interface ChatHistoryEntry {
    role: 'user' | 'model';
    parts: string;
}

interface ChatRequestBody {
    message: string;
    history?: ChatHistoryEntry[];
    uid?: string;
}

/**
 * Fetches the user's cached insights and prediction documents from Firestore,
 * then formats them into a context block that the AI can reference.
 * Failures are silently ignored — the chatbot works with or without context.
 */
async function buildUserContext(uid: string): Promise<string> {
    const [insightsResult, predictionResult, appliancesResult] = await Promise.allSettled([
        fetchInsightsForUser(uid),
        fetchPredictionForUser(uid),
        fetchAppliancesForUser(uid),
    ]);

    const insights = insightsResult.status === 'fulfilled' ? insightsResult.value : null;
    const prediction = predictionResult.status === 'fulfilled' ? predictionResult.value : null;
    const appliances = appliancesResult.status === 'fulfilled' ? appliancesResult.value : null;

    if (!insights && !prediction && !appliances) {
        return '';
    }

    const sections: string[] = [];

    if (insights) {
        const { _doc_id, ...rest } = insights as Record<string, any>;
        sections.push('=== USER ENERGY INSIGHTS ===\n' + JSON.stringify(rest, null, 2));
    }

    if (prediction) {
        const { _doc_id, ...rest } = prediction as Record<string, any>;
        sections.push('=== USER ENERGY PREDICTION ===\n' + JSON.stringify(rest, null, 2));
    }

    if (appliances && appliances.length > 0) {
        sections.push('=== USER APPLIANCES ===\n' + JSON.stringify(appliances, null, 2));
    }

    return (
        '\n\n--- USER DATA (from their electricity bills and AI analysis) ---\n' +
        'Use this data to give personalised, specific answers about the user\'s energy usage, ' +
        'bills, predictions, appliances, and saving opportunities. Reference actual numbers when relevant.\n\n' +
        sections.join('\n\n')
    );
}

export const sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { message, history, uid } = req.body as ChatRequestBody;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            res.status(400).json({ error: 'No message provided' });
            return;
        }

        // Build a personalised system instruction when a uid is available
        let systemContent = SYSTEM_INSTRUCTION;

        if (uid && typeof uid === 'string') {
            try {
                const userContext = await buildUserContext(uid);
                if (userContext.length > 0) {
                    systemContent += userContext;
                }
            } catch (ctxErr) {
                console.warn('[Chat] Failed to fetch user context, proceeding without:', ctxErr);
            }
        }

        // Build messages array for OpenAI-compatible chat completions
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemContent },
        ];

        // Map history entries, trimming to last MAX_HISTORY_MESSAGES to save tokens
        if (Array.isArray(history)) {
            const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);
            for (const entry of trimmedHistory) {
                messages.push({
                    role: entry.role === 'user' ? 'user' : 'assistant',
                    content: entry.parts,
                });
            }
        }

        // Add the current user message
        messages.push({ role: 'user', content: message });

        const response = await ai.chat.completions.create({
            model: AI_MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 500,
        });

        const replyText = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

        res.status(200).json({ reply: replyText });
    } catch (error) {
        console.error('Chat Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to generate chat response';
        res.status(500).json({ error: errorMessage });
    }
};
