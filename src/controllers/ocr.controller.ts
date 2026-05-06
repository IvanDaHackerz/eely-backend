import { Request, Response } from 'express';

// ─── OCR: Google Vision (KEPT as-is) ────────────────────────────────────────

export const extractText = async (req: Request, res: Response): Promise<void> => {
    try {
        const { image } = req.body;

        if (!image) {
            res.status(400).json({ error: 'No image provided' });
            return;
        }

        const apiKey = process.env.GOOGLE_VISION_API_KEY;
        if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
            res.status(500).json({ error: 'GOOGLE_VISION_API_KEY is not configured in backend/.env' });
            return;
        }

        // Google Vision API expects raw base64, so strip the "data:image/jpeg;base64," prefix if present
        const base64Data = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

        const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [
                    {
                        image: { content: base64Data },
                        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Google Vision API Error:', errorData);
            res.status(response.status).json({ error: 'Google Vision API request failed' });
            return;
        }

        const result = await response.json();

        // Safely extract the full text annotation
        const annotations = result.responses?.[0]?.fullTextAnnotation;
        const text = annotations ? annotations.text : 'No text detected by Google Vision';

        res.status(200).json({ text });
    } catch (error) {
        console.error('OCR Error:', error);
        res.status(500).json({ error: 'Failed to extract text' });
    }
};

// ─── Text Analysis: DeepSeek V3.1 (via Together AI) ─────────────────────────

import { ai, AI_MODEL } from '../config/gemini';

export const analyzeText = async (req: Request, res: Response): Promise<void> => {
    try {
        const { text } = req.body;

        if (!text) {
            res.status(400).json({ error: 'No text provided' });
            return;
        }

        const prompt = `Extract data from this Meralco bill OCR text. Return ONLY a JSON object matching this schema (null if not found):
{
  "account_name": "string",
  "account_number": "string",
  "current_reading": "number",
  "distribution": "number",
  "due_date": "string (Month DD, YYYY)",
  "end_date": "string (Month DD, YYYY)",
  "fit_all": "number",
  "gea_all": "number",
  "generation": "number",
  "government_taxes": "number",
  "lifeline_subsidy": "number",
  "other_charges": "number",
  "previous_reading": "number",
  "rate_per_kwh": "number (PHP per kWh, look for 'Rate' or 'P/kWh' or 'per kWh' or 'Generation Rate' or similar)",
  "senior_citizen_subsidy": "number",
  "service_address": "string",
  "start_date": "string (Month DD, YYYY)",
  "system_loss": "number",
  "total_amount_due": "number",
  "total_kwh_used": "number",
  "transmission": "number",
  "universal_charges": "number"
}

OCR Text:
${text}`;

        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await ai.chat.completions.create({
                    model: AI_MODEL,
                    messages: [
                        { role: 'system', content: 'You are a JSON-only data extraction API. Return ONLY valid JSON. No markdown, no commentary, no chinese characters.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: attempt === 1 ? 0.0 : 0.2, // slight variation on retries
                    max_tokens: 800,
                    response_format: { type: 'json_object' }
                });

                let jsonString = response.choices[0]?.message?.content || '{}';

                // Strip markdown code blocks if AI accidentally includes them
                jsonString = jsonString.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
                jsonString = jsonString.replace(/^```\s*/, '').replace(/\s*```$/, '');

                // Extract JSON object if wrapped in extra text
                const firstBrace = jsonString.indexOf('{');
                const lastBrace = jsonString.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                }

                const parsedData = JSON.parse(jsonString);
                
                // If we successfully parsed it, return it
                res.status(200).json(parsedData);
                return;
            } catch (err) {
                console.warn(`[OCR Analyze] Attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
                if (attempt === MAX_RETRIES) {
                    throw new Error('Failed to parse AI output into JSON after multiple attempts.');
                }
            }
        }
    } catch (error) {
        console.error('AI Analysis Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to analyze text';
        res.status(500).json({ error: errorMessage });
    }
};
