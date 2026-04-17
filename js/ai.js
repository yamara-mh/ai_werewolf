// AI プレイヤーロジック
// callAI は api.js、プロンプト構築は prompts.js で定義されています

// --- AIプレイヤー（夜アクション専用） ---

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

  // --- プロンプト構築（データ収集） ---

  _buildSystemPrompt(aiPlayer) {
    const gs = this.gameState;
    const role = aiPlayer.role;
    const isWolf = isActualWolf(role);
    const teammates = isWolf
      ? gs.players
          .filter((p) => isActualWolf(p.role) && p.id !== aiPlayer.id)
          .map((p) => p.name)
          .join('、')
      : '';
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    return buildAiPlayerSystemPrompt(
      aiPlayer.name,
      aiPlayer.personality,
      role,
      isWolf,
      teammates,
      roomLevelPrompt,
    );
  }

  _buildSpeechPrompt(aiPlayer) {
    const gs = this.gameState;
    const alivePlayersText = gs.getAlivePlayers().map((p) => p.name).join('、');
    const recentPostsText = gs.bbsLog.slice(-30)
      .map((p) => `${p.playerName}: ${p.content}`)
      .join('\n');
    return buildAiPlayerSpeechUserPrompt(
      aiPlayer.name,
      gs.day,
      this._phaseLabel(),
      alivePlayersText,
      recentPostsText,
    );
  }

  _buildVotePrompt(aiPlayer, candidates) {
    const gs = this.gameState;
    const candidatesText = candidates.map((p) => p.name).join('、');
    const recentPostsText = gs.bbsLog.slice(-30)
      .map((p) => `${p.playerName}: ${p.content}`)
      .join('\n');
    return buildAiPlayerVoteUserPrompt(gs.day, candidatesText, recentPostsText);
  }

  _buildNightActionPrompt(aiPlayer, candidates) {
    const candidatesText = candidates.map((p) => p.name).join('、');
    return buildAiPlayerNightActionUserPrompt(aiPlayer.role, candidatesText);
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

    const userPrompt = this._buildPrompt(targetPlayers);

    try {
      const responseText = await callAI(BATCH_CONVERSATION_SYSTEM_PROMPT, userPrompt, aiApiKey, aiModel, {
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

  // --- プロンプト構築（データ収集） ---

  _buildPrompt(targetPlayers) {
    const gs = this.gameState;
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelLabel = ROOM_LEVELS[roomLevel]?.label || '';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    const allPlayers = gs.getAlivePlayers().map((p) => ({
      name: p.name,
      role: p.role,
      isHuman: p.isHuman || false,
      personality: p.personality || '',
      firstPersonPronouns: p.firstPersonPronouns || '',
      speakingStyle: p.speakingStyle || '',
    }));
    const todayPosts = gs.getTodayPosts();
    const wolfPosts = gs.bbsLog.filter(
      (p) => p.day === gs.day && (p.type === 'wolf_chat' || p.type === 'whisper')
    );
    const targetNames = targetPlayers.map((p) => p.name).join('、');
    return buildBatchConversationUserPrompt({
      roomLevelLabel,
      roomLevelPrompt,
      allPlayers,
      previousDaysSynopsis: gs.previousDaysSynopsis || '',
      todayPosts,
      wolfPosts,
      targetNames,
      targetCount: targetPlayers.length * 2,
    });
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
      const alternatePostKeys = ['conversations', 'messages', 'talks'];
      for (const key of alternatePostKeys) {
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

    // 先頭または末尾の中括弧が欠落しているケースへの対応
    const trimmed = text.trim();
    if (trimmed) {
      // 先頭の { がない場合、{ ... } で包んでみる
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        try { return parseMaybeNestedJson(`{${trimmed}}`); } catch (_) { /* ignore */ }
      }
      // 末尾の } がない場合（先頭の { はある）
      if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
        try { return parseMaybeNestedJson(`${trimmed}}`); } catch (_) { /* ignore */ }
      }
      // 先頭の [ がない場合
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        try { return parseMaybeNestedJson(`[${trimmed}]`); } catch (_) { /* ignore */ }
      }
      // 末尾の ] がない場合（先頭の [ はある）
      if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
        try { return parseMaybeNestedJson(`${trimmed}]`); } catch (_) { /* ignore */ }
      }
    }

    return null;
  }

  _findMatchingClosingIndex(text, startIndex, openChar, closeChar) {
    if (text[startIndex] !== openChar) return -1;

    let depth = 1;
    let inString = false;
    let escaped = false;

    for (let i = startIndex + 1; i < text.length; i += 1) {
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

    const userPrompt = this._buildVotePrompt(targetPlayers);

    try {
      const responseText = await callAI(BATCH_VOTE_SYSTEM_PROMPT, userPrompt, aiApiKey, aiModel, {
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
    const publicPosts = gs.getTodayPosts();
    const candidateNames = gs.getAlivePlayers().map((p) => p.name).join('、');
    const targetPlayersData = targetPlayers.map((p) => ({ name: p.name, role: p.role, personality: p.personality }));
    return buildBatchVoteUserPrompt({
      roomLevelPrompt,
      targetPlayers: targetPlayersData,
      candidateNames,
      publicPosts,
      logicAiOutput: gs.logicAiOutput,
    });
  }

  _parseVoteResponse(responseText, targetPlayers) {
    try {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      let jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : responseText.trim();

      let start = jsonStr.indexOf('{');
      let end = jsonStr.lastIndexOf('}');
      // 先頭または末尾の中括弧が欠落しているケースへの対応
      if (start === -1 && end === -1) {
        jsonStr = `{${jsonStr}}`;
        start = 0;
        end = jsonStr.length - 1;
      } else if (start === -1) {
        jsonStr = `{${jsonStr}`;
        start = 0;
      } else if (end === -1) {
        jsonStr = `${jsonStr}}`;
        end = jsonStr.length - 1;
      }

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
          return { name: player.name, thinking: null, vote: null, talk: '' };
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
          talk: target ? `${target.name} に投票します。` : '',
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

  // アドベンチャーモード用：全AIプレイヤーの会話を一括生成
  // CO・投票先変更も含む。戻り値: { posts: [{name, talk, coRole, vote}], summary }
  async generateAdventure(targetCount = 30) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);

    if (!aiApiKey || aiPlayers.length === 0) {
      return this._fallbackAdventure(aiPlayers, targetCount);
    }

    const userPrompt = this._buildAdventurePrompt(aiPlayers, targetCount);

    try {
      const responseText = await callAI(BATCH_CONVERSATION_SYSTEM_PROMPT, userPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 3000,
        reasoningEffort,
      });
      return this._parseAdventureResponse(responseText, aiPlayers);
    } catch (e) {
      console.warn('アドベンチャー会話生成エラー:', e);
      return this._fallbackAdventure(aiPlayers, targetCount);
    }
  }

  _buildAdventurePrompt(aiPlayers, targetCount) {
    const gs = this.gameState;
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelLabel = ROOM_LEVELS[roomLevel]?.label || '';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    // 全生存プレイヤー（人間含む）の情報を渡す
    const allPlayers = gs.getAlivePlayers().map((p) => {
      const voteTargetId = gs.votes[p.id];
      const voteTarget = voteTargetId ? gs.getPlayer(voteTargetId) : null;
      return {
        name: p.name,
        role: p.role,
        isHuman: p.isHuman || false,
        personality: p.personality || '',
        firstPersonPronouns: p.firstPersonPronouns || '',
        speakingStyle: p.speakingStyle || '',
        currentVote: voteTarget ? voteTarget.name : null,
      };
    });
    const todayPosts = gs.getTodayPosts();
    const wolfPosts = gs.bbsLog.filter(
      (p) => p.day === gs.day && (p.type === 'wolf_chat' || p.type === 'whisper')
    );
    const currentVotes = gs.getAlivePlayers()
      .filter((p) => gs.votes[p.id])
      .map((p) => {
        const target = gs.getPlayer(gs.votes[p.id]);
        return target ? { voterName: p.name, targetName: target.name } : null;
      })
      .filter(Boolean);
    return buildAdventureUserPrompt({
      roomLevelLabel,
      roomLevelPrompt,
      allPlayers,
      previousDaysSynopsis: gs.previousDaysSynopsis || '',
      todayPosts,
      wolfPosts,
      currentVotes,
      targetCount,
    });
  }

  _parseAdventureResponse(responseText, aiPlayers) {
    try {
      const data = this._normalizeConversationJson(responseText);
      if (!Array.isArray(data.posts)) throw new Error('postsが配列ではありません');

      const validNames = new Set(aiPlayers.map((p) => p.name));
      const aliveNames = new Set(this.gameState.getAlivePlayers().map((p) => p.name));

      const validPosts = data.posts.filter(
        (post) =>
          post &&
          typeof post.name === 'string' &&
          validNames.has(post.name) &&
      // talk がない場合でも coRole（CO専用投稿）や target（投票専用投稿）があれば有効とする
      (typeof post.talk === 'string' ? post.talk.trim() : (post.coRole || post.target))
      ).map((post) => {
        // target フィールド（新形式）と vote フィールド（旧形式）の両方に対応
        const voteValue = post.target || post.vote;
        return {
          name: post.name,
          talk: (typeof post.talk === 'string') ? post.talk : '',
          coRole: (typeof post.coRole === 'string' && post.coRole.trim()) ? post.coRole.trim() : null,
          vote: (typeof voteValue === 'string' && aliveNames.has(voteValue) && voteValue !== post.name) ? voteValue : null,
        };
      });

      if (validPosts.length === 0) throw new Error('有効な投稿がありません');

      return {
        posts: validPosts,
        summary: data.summary && typeof data.summary === 'object' ? data.summary : null,
      };
    } catch (e) {
      console.warn('アドベンチャー会話JSONパースエラー:', e, responseText);
      return this._fallbackAdventure(aiPlayers, 5);
    }
  }

  // 夜ターン: 今日のチャットを「前日までのあらすじ」としてまとめる
  // 戻り値: あらすじ文字列（失敗時は既存の logicAiOutput または空文字）
  async generateSynopsis() {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const todayPosts = gs.getTodayPosts();

    if (!aiApiKey || todayPosts.length === 0) {
      return gs.logicAiOutput || gs.previousDaysSynopsis || '';
    }

    const userPrompt = buildSynopsisUserPrompt(gs.day, gs.previousDaysSynopsis, todayPosts);

    try {
      return await callAI(SYNOPSIS_SYSTEM_PROMPT, userPrompt, aiApiKey, aiModel, {
        maxTokens: 500,
        reasoningEffort,
      });
    } catch (e) {
      console.warn('あらすじ生成エラー:', e);
      return gs.logicAiOutput || gs.previousDaysSynopsis || '';
    }
  }

  _fallbackAdventure(aiPlayers, count) {
    const speeches = [
      'う〜ん、誰が怪しいかな…',
      'みんな落ち着いて議論しましょう。',
      '私はまだ判断できていません。情報を集めましょう。',
      '昨日の行動を振り返ってみるべきでは？',
      '誰か怪しい人の名前を挙げてみてください。',
    ];
    const targets = aiPlayers.length > 0 ? aiPlayers : [{ name: '？', role: null, personality: null }];
    const total = Math.min(count, targets.length * 4);
    return {
      posts: Array.from({ length: total }, (_, i) => ({
        name: targets[i % targets.length].name,
        talk: speeches[Math.floor(Math.random() * speeches.length)],
        coRole: null,
        vote: null,
      })),
      summary: null,
    };
  }
}
