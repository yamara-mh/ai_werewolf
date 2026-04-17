// AI API 通信レイヤー
// Gemini / OpenAI 互換API への共通リクエスト関数

async function callAI(systemPrompt, userPrompt, apiKey, model, options = {}) {
  const { jsonMode = false, maxTokens = 400, reasoningEffort = 'medium' } = options;
  const validReasoningEffort = ['low', 'medium', 'high'].includes(reasoningEffort)
    ? reasoningEffort
    : 'medium';

  if (model.startsWith('gemini-')) {
    const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.8 };
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
              parts: [{ text: `System:\n${systemPrompt}\n\nUser:\n${userPrompt}` }],
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
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() || '';
  }

  const openAiBody = {
    model: model || 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.8,
    reasoning_effort: validReasoningEffort,
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
  return data.choices?.[0]?.message?.content?.trim() || '';
}
