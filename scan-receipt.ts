import type { HandlerEvent, HandlerContext } from '@netlify/functions';

const allowedOrigins = new Set([
  'https://snapkihk.netlify.app',
  'http://localhost:8081',
  'http://localhost:19006',
]);

const receiptPrompt = `
你是 Snap記的收據與付款截圖辨識助手。

請只辨識一筆已完成付款，並且只回傳有效 JSON，不要 Markdown 或解釋。

格式：
{
  "merchant": "",
  "amount": 0,
  "date": "",
  "paymentMethod": "其他",
  "category": "其他",
  "confidence": 0
}

規則：
- amount 是實際付款總額，只填數字。
- date 使用 YYYY-MM-DD；不確定就留空字串。
- paymentMethod 只可為 Apple Pay、AlipayHK、WeChat Pay HK、FPS、現金、其他。
- category 只可為 交通、飲食、購物、娛樂、醫療、住屋、其他。
- confidence 必須是 0 至 1。
`;

interface ScanRequestBody {
  imageDataUrl?: string;
}

interface ScanDraft {
  merchant: string;
  amount: number;
  date: string;
  paymentMethod: string;
  category: string;
  confidence: number;
}

interface ScanResponse {
  draft?: ScanDraft;
  error?: string;
}

function response(statusCode: number, body: ScanResponse, origin = '') {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function parseAiJson(text: string) {
  const clean = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');

  if (start < 0 || end < start) {
    throw new Error('AI 沒有回傳可讀取的 JSON。');
  }

  return JSON.parse(clean.slice(start, end + 1));
}

function normalizeDraft(value: unknown): ScanDraft {
  const paymentMethods = new Set([
    'Apple Pay',
    'AlipayHK',
    'WeChat Pay HK',
    'FPS',
    '現金',
    '其他',
  ]);

  const categories = new Set([
    '交通',
    '飲食',
    '購物',
    '娛樂',
    '醫療',
    '住屋',
    '其他',
  ]);

  const raw = value as Record<string, unknown> | null | undefined;
  const amount = Number(raw?.amount);

  return {
    merchant:
      typeof raw?.merchant === 'string'
        ? raw.merchant.trim().slice(0, 120)
        : '',
    amount:
      Number.isFinite(amount) && amount > 0
        ? Math.round(amount * 100) / 100
        : 0,
    date:
      typeof raw?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
        ? raw.date
        : '',
    paymentMethod:
      typeof raw?.paymentMethod === 'string' && paymentMethods.has(raw.paymentMethod)
        ? raw.paymentMethod
        : '其他',
    category:
      typeof raw?.category === 'string' && categories.has(raw.category)
        ? raw.category
        : '其他',
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0)),
  };
}

export async function handler(event: HandlerEvent, _context: HandlerContext) {
  const origin = event.headers.origin || '';

  if (event.httpMethod === 'OPTIONS') {
    return response(204, {}, origin);
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { error: '只支援 POST。' }, origin);
  }

  if (!allowedOrigins.has(origin)) {
    return response(403, { error: '不允許的來源。' }, origin);
  }

  const endpoint = String(process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '');
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    return response(500, { error: '伺服器尚未完成 Azure 設定。' }, origin);
  }

  let input: ScanRequestBody;

  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: '請求格式不正確。' }, origin);
  }

  const imageDataUrl = input.imageDataUrl;

  if (
    typeof imageDataUrl !== 'string' ||
    !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageDataUrl)
  ) {
    return response(400, { error: '請提供 JPG、PNG 或 WEBP 圖片。' }, origin);
  }

  if (imageDataUrl.length > 7_000_000) {
    return response(413, { error: '圖片太大，請使用小於約 5 MB 的圖片。' }, origin);
  }

  try {
    const azureResponse = await fetch(
      `${endpoint}/openai/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: deployment,
          messages: [
            {
              role: 'system',
              content: '你只會回傳有效 JSON。',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: receiptPrompt,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageDataUrl,
                    detail: 'low',
                  },
                },
              ],
            },
          ],
          temperature: 0,
          max_completion_tokens: 300,
          response_format: {
            type: 'json_object',
          },
        }),
      }
    );

    if (!azureResponse.ok) {
      const errorText = await azureResponse.text().catch(() => '');
      console.error('Azure OpenAI 錯誤狀態：', azureResponse.status, errorText);
      return response(500, { error: '未能完成收據辨識。' }, origin);
    }

    const azureResult = await azureResponse.json();
    const aiText = azureResult?.choices?.[0]?.message?.content ?? '';

    if (typeof aiText !== 'string' || !aiText.trim()) {
      console.error('AI 回傳內容為空或格式錯誤：', azureResult);
      return response(500, { error: '未能完成收據辨識。' }, origin);
    }

    const draft = normalizeDraft(parseAiJson(aiText));
    return response(200, { draft }, origin);
  } catch (error) {
    console.error(
      'Receipt scan error:',
      error instanceof Error ? error.message : String(error)
    );
    return response(500, { error: '未能完成收據辨識。' }, origin);
  }
}