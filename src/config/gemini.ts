import OpenAI from 'openai';
import { tavily } from '@tavily/core';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Together AI (DeepSeek V3.1) ────────────────────────────────────────────

function getTogetherApiKey(): string {
    const key = process.env.TOGETHER_API_KEY;
    if (!key) {
        throw new Error('Missing TOGETHER_API_KEY in .env file');
    }
    return key;
}

/**
 * OpenAI-compatible client pointed at Together AI's endpoint.
 * Model: deepseek-ai/DeepSeek-V3.1
 */
const ai = new OpenAI({
    apiKey: getTogetherApiKey(),
    baseURL: 'https://api.together.xyz/v1',
});

const AI_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// ─── Tavily (Web Search) ────────────────────────────────────────────────────

function getTavilyApiKey(): string {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
        throw new Error('Missing TAVILY_API_KEY in .env file');
    }
    return key;
}

const tavilyClient = tavily({ apiKey: getTavilyApiKey() });

export { ai, AI_MODEL, tavilyClient };
