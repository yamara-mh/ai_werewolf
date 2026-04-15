// AI プレイヤーロジック
// OpenAI API (または互換API) を使用してAIプレイヤーの発言・行動を生成します

// --- 共通APIコール ---

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

// --- ロジックAI ---

class LogicAI {
  constructor(gameState) {
    this.gameState = gameState;
  }

  async analyze() {
    const gs = this.gameState;
    const { aiApiKey, logicAiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey) return this._fallbackAnalysis();

    const model = logicAiModel || 'gemini-flash-latest';
    const systemPrompt = 'あなたは人狼ゲームを観察するロジックAIです。村人の視点でチャットを分析し、確定情報・役職予想・人狼ライン候補・推奨行動を簡潔に整理してください。日本語で出力してください。';
    const userPrompt = this._buildAnalysisPrompt();

    try {
      return await callAI(systemPrompt, userPrompt, aiApiKey, model, { reasoningEffort });
    } catch (e) {
      console.warn('ロジックAI分析エラー:', e);
      return this._fallbackAnalysis();
    }
  }

  _buildAnalysisPrompt() {
    const gs = this.gameState;
    const alivePlayers = gs.getAlivePlayers().map((p) => p.name).join('、');
    const deadPlayers = gs.players
      .filter((p) => !p.isAlive)
      .map((p) => p.name)
      .join('、');

    const recentPosts = gs.bbsLog
      .filter((p) => p.type !== 'system')
      .slice(-30)
      .map((p) => {
        const coLabel = p.coRole ? `[${ROLE_BY_ID?.[p.coRole]?.name || p.coRole}CO]` : '';
        return `${p.playerName}${coLabel}: ${p.content}`;
      })
      .join('\n');

    return `現在: ${gs.day}日目
生存プレイヤー: ${alivePlayers}
${deadPlayers ? `死亡・処刑: ${deadPlayers}` : ''}

以下の形式で分析してください：
【確定情報】役職COした人物・死亡者など
【役職予想】各プレイヤーの役職予想と根拠
【人狼ライン候補】人狼の可能性が高いプレイヤーと理由
【推奨行動】村人陣営として取るべき行動

チャットログ（最近の発言）:
${recentPosts || '（発言なし）'}`;
  }

  _fallbackAnalysis() {
    return '（APIキーが設定されていないため、分析できません）';
  }
}

// --- AIプレイヤー ---

class AIPlayer {
  constructor(gameState) {
    this.gameState = gameState;
  }

  // AIプレイヤーの発言を生成
  async generateSpeech(aiPlayer) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildSpeechPrompt(aiPlayer);

    if (!aiApiKey) {
      return this._fallbackSpeech(aiPlayer);
    }

    try {
      const response = await callAI(systemPrompt, userPrompt, aiApiKey, aiModel, { reasoningEffort });
      return response;
    } catch (e) {
      console.warn(`AI発言生成エラー (${aiPlayer.name}):`, e);
      return this._fallbackSpeech(aiPlayer);
    }
  }

  // AIプレイヤーの投票先を決定
  async decideVote(aiPlayer) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const alivePlayers = gs.getAlivePlayers().filter((p) => p.id !== aiPlayer.id);

    if (!aiApiKey || alivePlayers.length === 0) {
      return this._fallbackVote(aiPlayer, alivePlayers);
    }

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildVotePrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await callAI(systemPrompt, userPrompt, aiApiKey, aiModel, { reasoningEffort });
      const target = this._parseVoteTarget(responseText, alivePlayers);
      return target || this._fallbackVote(aiPlayer, alivePlayers);
    } catch (e) {
      console.warn(`AI投票決定エラー (${aiPlayer.name}):`, e);
      return this._fallbackVote(aiPlayer, alivePlayers);
    }
  }

  // AIプレイヤーの夜アクション対象を決定
  async decideNightAction(aiPlayer) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    // 人狼は人間以外の村人を優先して狙う（またはAI村人）
    const alivePlayers = gs.getAlivePlayers().filter((p) => p.id !== aiPlayer.id);
    if (alivePlayers.length === 0) return null;

    if (!aiApiKey) {
      return this._fallbackNightAction(aiPlayer, alivePlayers);
    }

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildNightActionPrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await callAI(systemPrompt, userPrompt, aiApiKey, aiModel, { reasoningEffort });
      const target = this._parseVoteTarget(responseText, alivePlayers);
      return target || this._fallbackNightAction(aiPlayer, alivePlayers);
    } catch (e) {
      console.warn(`AI夜アクション決定エラー (${aiPlayer.name}):`, e);
      return this._fallbackNightAction(aiPlayer, alivePlayers);
    }
  }

  // --- プロンプト構築 ---

  _buildSystemPrompt(aiPlayer) {
    const gs = this.gameState;
    const role = aiPlayer.role;
    const teammates = isActualWolf(role)
      ? gs.players
          .filter((p) => isActualWolf(p.role) && p.id !== aiPlayer.id)
          .map((p) => p.name)
          .join('、')
      : '';

    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';

    const logicAiSection = gs.logicAiOutput
      ? `\nあなたの思考（ロジック分析）:\n${gs.logicAiOutput}`
      : '';

    return `あなたは人狼ゲームのAIプレイヤーです。
名前: ${aiPlayer.name}
性格・スタイル: ${aiPlayer.personality}
役職: ${role?.name || '不明'}（${role?.description || ''}）
チーム: ${isActualWolf(role) ? '人狼陣営' : '村人陣営'}
${isActualWolf(role) && teammates ? `仲間の人狼: ${teammates}\n` : ''}${roomLevelPrompt ? `${roomLevelPrompt}\n` : ''}ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く（1〜3文）発言してください。
役職は絶対に明かさないでください（占い師が公開する場合を除く）。
ゲームを楽しく盛り上げるよう心がけてください。${logicAiSection}`;
  }

  _buildSpeechPrompt(aiPlayer) {
    const gs = this.gameState;
    const recentPosts = gs.bbsLog.slice(-30).map(
      (p) => `${p.playerName}: ${p.content}`
    ).join('\n');

    return `現在: ${gs.day}日目 ${this._phaseLabel()}
生存プレイヤー: ${gs.getAlivePlayers().map((p) => p.name).join('、')}

最近の掲示板の発言:
${recentPosts || '（まだ発言はありません）'}

あなた（${aiPlayer.name}）の発言を1〜3文で生成してください。発言のみを出力してください。`;
  }

  _buildVotePrompt(aiPlayer, candidates) {
    const gs = this.gameState;
    const recentPosts = gs.bbsLog.slice(-30).map(
      (p) => `${p.playerName}: ${p.content}`
    ).join('\n');

    return `現在: ${gs.day}日目 投票フェーズ
投票可能なプレイヤー: ${candidates.map((p) => p.name).join('、')}

最近の発言:
${recentPosts || '（発言なし）'}

誰に投票しますか？候補者の名前を一人だけ答えてください。`;
  }

  _buildNightActionPrompt(aiPlayer, candidates) {
    const role = aiPlayer.role;
    let actionDesc = '';
    if (isWerewolfRole(role)) actionDesc = '今夜襲撃する村人を選んでください。';
    else if (role?.id === ROLES.SEER.id) actionDesc = '今夜占うプレイヤーを選んでください。';
    else if (role?.id === ROLES.HUNTER.id) actionDesc = '今夜護衛するプレイヤーを選んでください。';
    else actionDesc = '夜のアクション対象を選んでください。';

    return `夜フェーズです。${actionDesc}
対象プレイヤー: ${candidates.map((p) => p.name).join('、')}

対象の名前を一人だけ答えてください。`;
  }

  // --- フォールバック（APIなし時） ---

  _fallbackSpeech(aiPlayer) {
    const gs = this.gameState;
    const phase = gs.phase;

    const speeches = {
      [GAME_PHASES.DAY]: [
        `う〜ん、誰が怪しいかな…`,
        `みんな落ち着いて議論しましょう。`,
        `私はまだ判断できていませんが、情報を集めましょう。`,
        `昨日の行動を振り返ってみるべきでは？`,
        `誰か怪しい人の名前を挙げてみてください。`,
      ],
      [GAME_PHASES.VOTE]: [
        `私の判断では…${this._getRandomAlive(aiPlayer)?.name || '誰か'}が怪しいと思います。`,
        `消去法で考えると、一人に絞られてきますね。`,
        `みなさんの意見も聞かせてください。`,
      ],
    };

    const options = speeches[phase] || speeches[GAME_PHASES.DAY];
    return options[Math.floor(Math.random() * options.length)];
  }

  _fallbackVote(aiPlayer, candidates) {
    if (candidates.length === 0) return null;
    // 人狼なら村人陣営を優先
    if (aiPlayer.role?.team === TEAMS.WEREWOLF) {
      const villager = candidates.find((p) => p.role?.team === TEAMS.VILLAGE);
      if (villager) return villager;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _fallbackNightAction(aiPlayer, candidates) {
    if (candidates.length === 0) return null;
    // 人狼は人間プレイヤーを優先して狙う
    if (isWerewolfRole(aiPlayer.role)) {
      const humanTarget = candidates.find((p) => p.isHuman);
      if (humanTarget) return humanTarget;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _parseVoteTarget(text, candidates) {
    for (const candidate of candidates) {
      if (text.includes(candidate.name)) return candidate;
    }
    return null;
  }

  _getRandomAlive(exclude) {
    const gs = this.gameState;
    const alive = gs.getAlivePlayers().filter((p) => p.id !== exclude.id);
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  _phaseLabel() {
    const labels = {
      [GAME_PHASES.MORNING]: '朝',
      [GAME_PHASES.DAY]: '昼（議論）',
      [GAME_PHASES.VOTE]: '投票',
      [GAME_PHASES.NIGHT]: '夜',
    };
    return labels[this.gameState.phase] || '';
  }
}

// --- バッチ会話生成AI ---
// 複数AIプレイヤーの発言と状況整理を一度のAPIコールで生成します

class BatchConversationAI {
  constructor(gameState) {
    this.gameState = gameState;
  }

  // targetPlayers: 発言を生成するAIプレイヤーの配列
  // 戻り値: { posts: [{name, thinking, talk}], summary: {chat, prediction} | null }
  async generate(targetPlayers) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey || targetPlayers.length === 0) {
      return this._fallback(targetPlayers);
    }

    const systemPrompt = '人狼ゲームの進行AIです。登場人物たちの会話を、指定されたJSON形式で生成してください。';
    const userPrompt = this._buildPrompt(targetPlayers);

    try {
      const responseText = await callAI(systemPrompt, userPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 1500,
        reasoningEffort,
      });
      return this._parseResponse(responseText, targetPlayers);
    } catch (e) {
      console.warn('バッチ会話生成エラー:', e);
      return this._fallback(targetPlayers);
    }
  }

  _buildPrompt(targetPlayers) {
    const gs = this.gameState;
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    const lines = [];

    lines.push('人狼ゲームのチャット履歴を見て会話の続きを生成してください。');
    lines.push('');

    if (roomLevelPrompt) {
      lines.push('# 備考');
      lines.push(roomLevelPrompt);
      lines.push('');
    }

    // 登場人物セクション
    lines.push('# 登場人物');
    gs.getAlivePlayers().forEach((player) => {
      if (player.isHuman) return;
      lines.push(`## ${player.name}`);
      lines.push(`役職：${player.role?.name || '村人'}`);
      if (player.personality) lines.push(`性格・スタイル：${player.personality}`);
    });
    lines.push('');

    // チャット履歴
    lines.push('# チャット履歴');
    const publicPosts = gs.bbsLog
      .filter((p) => p.type !== 'wolf_chat' && p.type !== 'whisper')
      .slice(-50);
    publicPosts.forEach((post) => {
      lines.push(post.type === 'system'
        ? this._formatSystemEntry(post)
        : this._formatPostEntry(post));
    });
    lines.push('');

    // 人狼チャット履歴（人狼プレイヤーがいる場合のみ含める）
    const wolfPosts = gs.bbsLog.filter((p) => p.type === 'wolf_chat' || p.type === 'whisper');
    if (wolfPosts.length > 0) {
      lines.push('# 人狼チャット履歴');
      wolfPosts.forEach((post) => lines.push(this._formatPostEntry(post)));
      lines.push('');
    }

    // 前回の状況整理
    if (gs.logicAiOutput) {
      lines.push('# 前回の状況整理');
      lines.push(gs.logicAiOutput);
      lines.push('');
    }

    // 生成対象プレイヤー
    const targetNames = targetPlayers.map((p) => p.name).join('、');
    lines.push('# 生成対象プレイヤー');
    lines.push(`以下のプレイヤーたちの発言を生成してください：${targetNames}`);
    lines.push('目安として各プレイヤーが1〜2回発言するようにし、全員が最低1回は発言してください。');
    lines.push('');

    // 出力形式
    lines.push('# 出力形式');
    lines.push('以下のJSON形式で出力してください：');
    lines.push(JSON.stringify({
      posts: [{ name: 'プレイヤー名', thinking: '内部思考（省略可）', talk: '発言内容', delay: 1.5 }],
      summary: { chat: '現在の会話状況のまとめ', prediction: '各プレイヤーの役職予想' },
    }, null, 2));
    lines.push('delay はこの投稿を表示するまでの秒数（0.5〜4.0）です。会話の間合いや盛り上がりに合わせてAIが適宜決めてください。');
    lines.push('posts の順番・件数（各プレイヤーの発言回数を含む）もAIが自由に決めてください。');

    return lines.join('\n');
  }

  _formatSystemEntry(post) {
    return [
      '"system" : {',
      `    "message" : "${this._escapeForJson(post.content)}",`,
      `    "date" : "${post.timestamp}"`,
      '}',
    ].join('\n');
  }

  _formatPostEntry(post) {
    return [
      '"post" : {',
      `    "name" : "${this._escapeForJson(post.playerName)}",`,
      `    "talk" : "${this._escapeForJson(post.content)}",`,
      `    "date" : "${post.timestamp}"`,
      '}',
    ].join('\n');
  }

  _parseResponse(responseText, targetPlayers) {
    try {
      const data = this._normalizeConversationJson(responseText);
      if (!Array.isArray(data.posts)) throw new Error('postsが配列ではありません');

      const validNames = new Set(targetPlayers.map((p) => p.name));
      const validPosts = data.posts.filter(
        (post) =>
          post &&
          typeof post.name === 'string' &&
          validNames.has(post.name) &&
          typeof post.talk === 'string' &&
          post.talk.trim()
      ).map((post) => ({
        name: post.name,
        thinking: post.thinking || null,
        talk: post.talk,
        delay: (typeof post.delay === 'number' && post.delay > 0) ? post.delay : null,
      }));

      if (validPosts.length === 0) throw new Error('有効な投稿がありません');

      return {
        posts: validPosts,
        summary: data.summary && typeof data.summary === 'object' ? data.summary : null,
      };
    } catch (e) {
      console.warn('バッチ会話JSONパースエラー:', e, responseText);
      return this._fallback(targetPlayers);
    }
  }

  _normalizeConversationJson(responseText) {
    const parsed = this._extractJsonFromText(responseText);
    if (Array.isArray(parsed)) {
      return { posts: parsed, summary: null };
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.posts)) return parsed;
      if (parsed.data && typeof parsed.data === 'object' && Array.isArray(parsed.data.posts)) {
        return { posts: parsed.data.posts, summary: parsed.data.summary || null };
      }
      for (const key of ['conversations', 'messages', 'talks']) {
        if (Array.isArray(parsed[key])) {
          return { posts: parsed[key], summary: parsed.summary || null };
        }
      }
    }
    throw new Error('postsが配列ではありません');
  }

  _extractJsonFromText(responseText) {
    const text = String(responseText || '').trim();
    if (!text) throw new Error('応答が空です');

    const candidates = [text];
    const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
    for (const match of codeBlocks) {
      const body = (match[1] || '').trim();
      if (body) candidates.unshift(body);
    }

    for (const candidate of candidates) {
      const parsed = this._tryParseJsonCandidate(candidate);
      if (parsed !== null) return parsed;
    }
    throw new Error('JSONオブジェクトが見つかりません');
  }

  _tryParseJsonCandidate(text) {
    const parseMaybeNestedJson = (raw) => {
      const first = JSON.parse(raw);
      if (typeof first === 'string') {
        try {
          return JSON.parse(first);
        } catch (_) {
          return first;
        }
      }
      return first;
    };

    try {
      return parseMaybeNestedJson(text.trim());
    } catch (_) {
      // ignore
    }

    const starts = [];
    const objectStart = text.indexOf('{');
    if (objectStart !== -1) starts.push({ index: objectStart, open: '{', close: '}' });
    const arrayStart = text.indexOf('[');
    if (arrayStart !== -1) starts.push({ index: arrayStart, open: '[', close: ']' });
    starts.sort((a, b) => a.index - b.index);

    for (const { index, open, close } of starts) {
      const end = this._findMatchingClosingIndex(text, index, open, close);
      if (end <= index) continue;
      const sliced = text.slice(index, end + 1).trim();
      if (!sliced) continue;
      try {
        return parseMaybeNestedJson(sliced);
      } catch (_) {
        // ignore
      }
    }
    return null;
  }

  _findMatchingClosingIndex(text, startIndex, openChar, closeChar) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) {
        depth += 1;
        continue;
      }
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // 投票フェーズ：AIプレイヤー全員の投票先・発言を一括生成
  // 戻り値: { votes: [{name, thinking, vote, talk, delay}] }
  async generateVotes(targetPlayers) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey || targetPlayers.length === 0) {
      return this._fallbackVotes(targetPlayers);
    }

    const systemPrompt = '人狼ゲームの進行AIです。投票フェーズにおける各キャラクターの投票先と発言を、指定されたJSON形式で生成してください。';
    const userPrompt = this._buildVotePrompt(targetPlayers);

    try {
      const responseText = await callAI(systemPrompt, userPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 1500,
        reasoningEffort,
      });
      return this._parseVoteResponse(responseText, targetPlayers);
    } catch (e) {
      console.warn('バッチ投票生成エラー:', e);
      return this._fallbackVotes(targetPlayers);
    }
  }

  _buildVotePrompt(targetPlayers) {
    const gs = this.gameState;
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    const lines = [];

    lines.push('投票フェーズです。各キャラクターが誰に投票するかを決め、投票宣言の発言を生成してください。');
    lines.push('');

    if (roomLevelPrompt) {
      lines.push('# 備考');
      lines.push(roomLevelPrompt);
      lines.push('');
    }

    // 登場人物セクション
    lines.push('# 登場人物（投票権あり）');
    targetPlayers.forEach((player) => {
      lines.push(`## ${player.name}`);
      lines.push(`役職：${player.role?.name || '村人'}`);
      if (player.personality) lines.push(`性格・スタイル：${player.personality}`);
    });
    lines.push('');

    // 投票候補
    const candidateNames = gs.getAlivePlayers().map((p) => p.name).join('、');
    lines.push('# 投票候補（生存プレイヤー）');
    lines.push(candidateNames);
    lines.push('');

    // チャット履歴
    lines.push('# チャット履歴（議論の流れ）');
    const publicPosts = gs.bbsLog
      .filter((p) => p.type !== 'wolf_chat' && p.type !== 'whisper')
      .slice(-50);
    publicPosts.forEach((post) => {
      lines.push(post.type === 'system'
        ? this._formatSystemEntry(post)
        : this._formatPostEntry(post));
    });
    lines.push('');

    // 前回の状況整理
    if (gs.logicAiOutput) {
      lines.push('# 前回の状況整理');
      lines.push(gs.logicAiOutput);
      lines.push('');
    }

    // 出力形式
    lines.push('# 出力形式');
    lines.push('以下のJSON形式で出力してください：');
    lines.push(JSON.stringify({
      votes: [{ name: 'プレイヤー名', thinking: '投票理由（内部思考）', vote: '投票先プレイヤー名', talk: '投票宣言の発言', delay: 1.5 }],
    }, null, 2));
    lines.push('vote は投票候補の中から必ず一人を選んでください（自分自身は不可）。');
    lines.push('talk は「○○に投票します」のような投票宣言の発言です。');
    lines.push('delay はこの投稿を表示するまでの秒数（0.5〜3.0）です。間合いを自然に決めてください。');
    lines.push('全員が必ず一票を投じてください。');

    return lines.join('\n');
  }

  _parseVoteResponse(responseText, targetPlayers) {
    try {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : responseText.trim();

      const start = jsonStr.indexOf('{');
      const end = jsonStr.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('JSONオブジェクトが見つかりません');

      const data = JSON.parse(jsonStr.slice(start, end + 1));
      if (!Array.isArray(data.votes)) throw new Error('votesが配列ではありません');

      const gs = this.gameState;
      const aliveNames = new Set(gs.getAlivePlayers().map((p) => p.name));
      const validNames = new Set(targetPlayers.map((p) => p.name));

      const validVotes = data.votes.filter(
        (v) =>
          v &&
          typeof v.name === 'string' &&
          validNames.has(v.name) &&
          typeof v.vote === 'string' &&
          aliveNames.has(v.vote) &&
          v.name !== v.vote &&
          typeof v.talk === 'string' &&
          v.talk.trim()
      ).map((v) => ({
        name: v.name,
        thinking: v.thinking || null,
        vote: v.vote,
        talk: v.talk,
        delay: (typeof v.delay === 'number' && v.delay > 0) ? v.delay : null,
      }));

      if (validVotes.length === 0) throw new Error('有効な投票データがありません');

      return { votes: validVotes };
    } catch (e) {
      console.warn('バッチ投票JSONパースエラー:', e, responseText);
      return this._fallbackVotes(targetPlayers);
    }
  }

  _fallbackVotes(targetPlayers) {
    const gs = this.gameState;
    return {
      votes: targetPlayers.map((player) => {
        const candidates = gs.getAlivePlayers().filter((p) => p.id !== player.id);
        if (candidates.length === 0) {
          return { name: player.name, thinking: null, vote: null, talk: '棄権します。', delay: null };
        }
        let target = null;
        if (isWerewolfRole(player.role)) {
          target = candidates.find((p) => p.role?.team === TEAMS.VILLAGE) || candidates[0];
        } else {
          target = candidates[Math.floor(Math.random() * candidates.length)];
        }
        return {
          name: player.name,
          thinking: null,
          vote: target ? target.name : null,
          talk: target ? `${target.name} に投票します。` : '棄権します。',
          delay: null,
        };
      }),
    };
  }

  _fallback(targetPlayers) {
    const speeches = [
      'う〜ん、誰が怪しいかな…',
      'みんな落ち着いて議論しましょう。',
      '私はまだ判断できていません。情報を集めましょう。',
      '昨日の行動を振り返ってみるべきでは？',
      '誰か怪しい人の名前を挙げてみてください。',
    ];
    return {
      posts: targetPlayers.map((player) => ({
        name: player.name,
        thinking: null,
        talk: speeches[Math.floor(Math.random() * speeches.length)],
      })),
      summary: null,
    };
  }

  _escapeForJson(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }
}
