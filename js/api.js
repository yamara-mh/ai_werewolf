// LLM API 通信
// Gemini / OpenAI 互換 API への共通リクエスト関数

const LLM_LOG_KEY = 'ai_werewolf_llm_log';
const LLM_LOG_MAX = 200;

function _appendLlmLog(model, userPrompt, response) {
  try {
    const existing = JSON.parse(localStorage.getItem(LLM_LOG_KEY) || '[]');
    existing.push({ timestamp: new Date().toISOString(), model, userPrompt, response });
    if (existing.length > LLM_LOG_MAX) existing.splice(0, existing.length - LLM_LOG_MAX);
    localStorage.setItem(LLM_LOG_KEY, JSON.stringify(existing));
  } catch (e) {
    // ストレージ容量不足などは無視
  }
}

async function callAI(userPrompt, apiKey, model, options = {}) {
  const { jsonMode = false, maxTokens = 1600, reasoningEffort = 'medium' } = options;
  const validReasoningEffort = ['minimal', 'low', 'medium', 'high'].includes(reasoningEffort)
    ? reasoningEffort
    : 'medium';
  const reasoningTokenMultiplier = { minimal: 0.5, low: 1, medium: 1.5, high: 2 };
  const scaledMaxTokens = Math.ceil(maxTokens * (reasoningTokenMultiplier[validReasoningEffort] ?? 1));

  const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  console.log(`[LLM Input] ${timestamp} User Prompt:\n`, userPrompt);

  if (model.startsWith('gemini-')) {
    const generationConfig = { maxOutputTokens: scaledMaxTokens, temperature: 0.8 };
    if (jsonMode) generationConfig.responseMimeType = 'application/json';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini API Error ${res.status}: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const geminiResult = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() || '';
    const outputTimestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    console.log(`[LLM Output] ${outputTimestamp}:\n`, geminiResult);
    _appendLlmLog(model, userPrompt, geminiResult);
    return geminiResult;
  }

  const openAiBody = {
    model: model || 'gpt-5.4-mini',
    messages: [
      { role: 'user', content: userPrompt },
    ],
    max_tokens: scaledMaxTokens,
    temperature: 0.8,
    reasoning_effort: validReasoningEffort === 'minimal' ? 'low' : validReasoningEffort,
  };
  if (jsonMode) openAiBody.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openAiBody),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`API Error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const openAiResult = data.choices?.[0]?.message?.content?.trim() || '';
  const outputTimestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  console.log(`[LLM Output] ${outputTimestamp}:\n`, openAiResult);
  _appendLlmLog(model, userPrompt, openAiResult);
  return openAiResult;
}
