// 有効なポートレートステータス
const VALID_PORTRAIT_STATUSES = new Set(['default', 'smile', 'smug', 'laugh', 'serious', 'thinking', 'annoyed', 'surprised', 'panicking', 'sad', 'embarrassed']);

// villager/werewolf フィールドのプレイヤー名配列を正規化するヘルパー
// 配列要素が文字列または {name: string} オブジェクトの両方に対応し、生存プレイヤー名のみを返す
function _normalizeVerdictNames(arr, aliveNames) {
  const items = Array.isArray(arr) ? arr : (arr && typeof arr === 'object' ? [arr] : []);
  return items.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof item.name === 'string') return item.name;
    return null;
  }).filter((name) => name && aliveNames.has(name));
}

function _normalizeConversationJson(responseText) {
  const parsed = _extractJsonFromText(responseText);
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

function _extractJsonFromText(responseText) {
  const text = String(responseText || '').trim();
  if (!text) throw new Error('応答が空です');

  const candidates = [text];
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks) {
    const body = (match[1] || '').trim();
    if (body) candidates.unshift(body);
  }

  for (const candidate of candidates) {
    const parsed = _tryParseJsonCandidate(candidate);
    if (parsed !== null) return parsed;
  }
  throw new Error('JSONオブジェクトが見つかりません');
}

function _tryParseJsonCandidate(text) {
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
    const end = _findMatchingClosingIndex(text, index, open, close);
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

function _findMatchingClosingIndex(text, startIndex, openChar, closeChar) {
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

    if (!aiApiKey) {
      return this._fallbackSpeech(aiPlayer);
    }

    const prompt = this._buildSystemPrompt(aiPlayer) + '\n\n' + this._buildSpeechPrompt(aiPlayer);

    try {
      const response = await callAI(prompt, aiApiKey, aiModel, { reasoningEffort });
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

    const prompt = this._buildSystemPrompt(aiPlayer) + '\n\n' + this._buildVotePrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await callAI(prompt, aiApiKey, aiModel, { reasoningEffort });
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

    const prompt = this._buildSystemPrompt(aiPlayer) + '\n\n' + this._buildNightActionPrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await callAI(prompt, aiApiKey, aiModel, { reasoningEffort });
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
        `[会話情報の取得に失敗しました]`,
      ],
      [GAME_PHASES.VOTE]: [
        `[会話情報の取得に失敗しました]`,
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
  // 戻り値: { posts: [{name, thinking, talk}] }
  async generate(targetPlayers) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey || targetPlayers.length === 0) {
      return this._fallback(targetPlayers);
    }

    const userPrompt = this._buildPrompt(targetPlayers);

    try {
      const responseText = await callAI(userPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 6000,
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

      return { posts: validPosts };
    } catch (e) {
      console.warn('バッチ会話JSONパースエラー:', e, responseText);
      return this._fallback(targetPlayers);
    }
  }

  _normalizeConversationJson(responseText) {
    return _normalizeConversationJson(responseText);
  }

  _extractJsonFromText(responseText) {
    return _extractJsonFromText(responseText);
  }

  _tryParseJsonCandidate(text) {
    return _tryParseJsonCandidate(text);
  }

  _findMatchingClosingIndex(text, startIndex, openChar, closeChar) {
    return _findMatchingClosingIndex(text, startIndex, openChar, closeChar);
  }

  _fallback(targetPlayers) {
    const speeches = [
        `[会話情報の取得に失敗しました]`,
    ];
    return {
      posts: targetPlayers.map((player) => ({
        name: player.name,
        thinking: null,
        talk: speeches[Math.floor(Math.random() * speeches.length)],
      })),
    };
  }

  // アドベンチャーモード用：全AIプレイヤーの会話を一括生成
  // CO・投票先変更も含む。戻り値: { posts: [{name, talk, coRole, vote}] }
  async generateAdventure(targetCount = 10) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const aiPlayers = gs.getAlivePlayers().filter((p) => !p.isHuman);

    if (!aiApiKey || aiPlayers.length === 0) {
      return this._fallbackAdventure(aiPlayers, targetCount);
    }

    const userPrompt = this._buildAdventurePrompt(aiPlayers, targetCount);

    try {
      const responseText = await callAI(userPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 8000,
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
        const statusValue = (typeof post.status === 'string' && VALID_PORTRAIT_STATUSES.has(post.status)) ? post.status : 'default';
        // villager（白だし）と werewolf（黒だし）のプレイヤー名配列を正規化
        const verdictWhite = _normalizeVerdictNames(post.villager, aliveNames);
        const verdictBlack = _normalizeVerdictNames(post.werewolf, aliveNames);
        return {
          name: post.name,
          talk: (typeof post.talk === 'string') ? post.talk : '',
          coRole: (typeof post.coRole === 'string' && post.coRole.trim()) ? post.coRole.trim() : null,
          vote: (typeof voteValue === 'string' && aliveNames.has(voteValue) && voteValue !== post.name) ? voteValue : null,
          status: statusValue,
          verdictWhite,
          verdictBlack,
        };
      });

      if (validPosts.length === 0) throw new Error('有効な投稿がありません');

      return { posts: validPosts };
    } catch (e) {
      console.warn('アドベンチャー会話JSONパースエラー:', e, responseText);
      return this._fallbackAdventure(aiPlayers, 5);
    }
  }

  // 夜ターン: 今日のチャットを「前日までのあらすじ」としてまとめる
  // 戻り値: あらすじ文字列（失敗時は既存の previousDaysSynopsis または空文字）
  async generateSynopsis() {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const todayPosts = gs.getTodayPosts();

    if (!aiApiKey || todayPosts.length === 0) {
      return gs.previousDaysSynopsis || '';
    }

    const userPrompt = buildSynopsisUserPrompt(gs.day, gs.previousDaysSynopsis, todayPosts);

    try {
      return await callAI(userPrompt, aiApiKey, aiModel, {
        maxTokens: 1000,
        reasoningEffort,
      });
    } catch (e) {
      console.warn('あらすじ生成エラー:', e);
      return gs.previousDaysSynopsis || '';
    }
  }

  _fallbackAdventure(aiPlayers, count) {
    const speeches = [
        `[会話情報の取得に失敗しました]`,
    ];
    const targets = aiPlayers.length > 0 ? aiPlayers : [{ name: '？', role: null, personality: null }];
    const total = Math.min(count, targets.length * 4);
    return {
      posts: Array.from({ length: total }, (_, i) => ({
        name: targets[i % targets.length].name,
        talk: speeches[Math.floor(Math.random() * speeches.length)],
        coRole: null,
        vote: null,
        status: 'default',
      })),
    };
  }
}

// --- プレイヤープロパティ割り当てAI ---
// プレイヤーの投稿内容を解析し、coRole, vote, villager, werewolf を付与したJSONを返す

class PlayerPropertyAI {
  constructor(gameState) {
    this.gameState = gameState;
  }

  // プレイヤーの投稿内容を解析してプロパティを付与
  // 戻り値: { coRole, vote, villager, werewolf } | null
  async analyzePost(player, content) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    if (!aiApiKey || !content || !content.trim()) {
      return this._fallback();
    }

    const prompt = this._buildPrompt(player, content);

    try {
      const responseText = await callAI(prompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 1000,
        reasoningEffort,
      });
      return this._parseResponse(responseText);
    } catch (e) {
      console.warn('プレイヤープロパティ解析エラー:', e);
      return this._fallback();
    }
  }

  _buildPrompt(player, content) {
    const gs = this.gameState;
    const role = player.role;
    const isWolf = isActualWolf(role);
    const isSeer = role?.id === ROLES.SEER.id;
    const isHunter = role?.id === ROLES.HUNTER.id;
    const isMedium = role?.id === ROLES.MEDIUM.id;

    const alivePlayersText = gs.getAlivePlayers()
      .map((p) => p.name)
      .join('、');

    const todayPosts = gs.getTodayPosts();

    const wolfPosts = isWolf
      ? gs.bbsLog.filter((p) => p.day === gs.day && (p.type === 'wolf_chat' || p.type === 'whisper'))
      : [];

    const seerResults = isSeer
      ? gs.players
          .filter((p) => p.seerVerdict != null)
          .map((p) => ({ targetName: p.name, isWerewolf: p.seerVerdict === 'black' }))
      : [];

    const hunterResult = (isHunter && player.lastGuardedId)
      ? (() => {
          const guarded = gs.getPlayer(player.lastGuardedId);
          return guarded ? { guardedName: guarded.name } : null;
        })()
      : null;

    const mediumResults = isMedium
      ? gs.players
          .filter((p) => !p.isAlive && p.deathReason === 'execution' && p.role)
          .map((p) => ({ targetName: p.name, isWerewolf: isSeerWerewolf(p.role) }))
      : [];

    const currentVotes = gs.getAlivePlayers()
      .filter((p) => gs.votes[p.id])
      .map((p) => {
        const target = gs.getPlayer(gs.votes[p.id]);
        return target ? { voterName: p.name, targetName: target.name } : null;
      })
      .filter(Boolean);

    return buildPlayerPropertyPrompt({
      player,
      content,
      day: gs.day,
      alivePlayersText,
      previousDaysSynopsis: gs.previousDaysSynopsis || '',
      todayPosts,
      wolfPosts,
      seerResults,
      hunterResult,
      mediumResults,
      currentVotes,
    });
  }

  _parseResponse(responseText) {
    try {
      const parsed = _extractJsonFromText(responseText);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('JSONオブジェクトではありません');
      }

      const aliveNames = new Set(this.gameState.getAlivePlayers().map((p) => p.name));
      
      return {
        coRole: (typeof parsed.coRole === 'string' && parsed.coRole.trim()) ? parsed.coRole.trim() : null,
        vote: (typeof parsed.vote === 'string' && aliveNames.has(parsed.vote)) ? parsed.vote : null,
        villager: _normalizeVerdictNames(parsed.villager, aliveNames),
        werewolf: _normalizeVerdictNames(parsed.werewolf, aliveNames),
      };
    } catch (e) {
      console.warn('プレイヤープロパティJSONパースエラー:', e, responseText);
      return this._fallback();
    }
  }

  _fallback() {
    return {
      coRole: null,
      vote: null,
      villager: [],
      werewolf: [],
    };
  }
}

// --- 会話精度向上AI ---
// 1発言ずつ、発言するキャラクターが知り得る情報だけを LLM に渡して生成します

class PrecisionConversationAI {
  constructor(gameState) {
    this.gameState = gameState;
    this._storySteps = [];
    this._waitingForHumanName = null;
    this._nextPreparedPosts = null; // 次の発言者の準備済み投稿
    this._isPreparingNext = false; // 次の発言準備中フラグ
  }

  // 昼フェーズ開始時にリセット
  resetQueue() {
    this._storySteps = [];
    this._waitingForHumanName = null;
    this._nextPreparedPosts = null;
    this._isPreparingNext = false;
  }

  invalidateStory() {
    this._storySteps = [];
    this._waitingForHumanName = null;
    this._nextPreparedPosts = null;
    this._isPreparingNext = false;
  }

  // ストーリーを再生成（公開メソッド）
  async refreshStory(unreflectedPosts = null) {
    return this._refreshStory(unreflectedPosts);
  }

  async _refreshStory(unreflectedPosts = null) {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;
    const alivePlayers = gs.getAlivePlayers();

    if (alivePlayers.length === 0) {
      this._storySteps = [];
      return;
    }

    if (!aiApiKey) {
      this._storySteps = this._fallbackStory();
      return;
    }

    const allPlayers = gs.players.map((p) => {
      const voteTargetId = gs.votes[p.id];
      const voteTarget = voteTargetId ? gs.getPlayer(voteTargetId) : null;
      return {
        name: p.name,
        role: p.role,
        isAlive: p.isAlive,
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

    const prompt = buildStorytellerConversationPrompt({
      day: gs.day,
      allPlayers,
      previousDaysSynopsis: gs.previousDaysSynopsis || '',
      todayPosts,
      wolfPosts,
      currentVotes,
      unreflectedPosts,
    });

    try {
      const responseText = await callAI(prompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 8000,
        reasoningEffort,
      });
      this._storySteps = this._parseStoryResponse(responseText);
    } catch (e) {
      console.warn('ストーリーテラーAI生成エラー:', e);
      this._storySteps = this._fallbackStory();
    }
  }

  _parseStoryResponse(responseText) {
    const parsed = _extractJsonFromText(responseText);
    const scenario = Array.isArray(parsed?.scenario)
      ? parsed.scenario
      : Array.isArray(parsed?.steps)
        ? parsed.steps
        : Array.isArray(parsed)
          ? parsed
          : [];
    const validNames = new Set(this.gameState.getAlivePlayers().map((p) => p.name));
    const steps = scenario
      .filter((step) => step && typeof step.name === 'string' && validNames.has(step.name.trim()))
      .map((step) => ({
        speaker: step.name.trim(),
        summary: typeof step.talk === 'string' ? step.talk.trim() 
               : typeof step.summary === 'string' ? step.summary.trim() 
               : '',
      }));

    if (steps.length === 0) throw new Error('ストーリーシナリオが空です');
    return steps;
  }

  _fallbackStory() {
    return this.gameState.getAlivePlayers()
      .filter((p) => !p.isHuman)
      .map((p) => ({ player: p, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ player }) => ({
        speaker: player.name,
        summary: '',
      }));
  }

  // 次の発言者を決定（ストーリーテラーAI指定 or ランダム）
  async _determineSpeaker() {
    const alivePlayers = this.gameState.getAlivePlayers();
    const aliveAiPlayers = alivePlayers.filter((p) => !p.isHuman);
    if (aliveAiPlayers.length === 0) return { speaker: null, storyStep: null };

    if (this._waitingForHumanName) {
      const waitingHuman = alivePlayers.find((p) => p.name === this._waitingForHumanName && p.isHuman);
      if (waitingHuman) {
        return { speaker: null, storyStep: null };
      }
      this._waitingForHumanName = null;
    }

    // ストーリーステップが空の場合は自動再生成しない
    // （会議開始時と、プレイヤー投稿時のみ明示的に refreshStory が呼ばれる）

    while (this._storySteps.length > 0) {
      const nextStep = this._storySteps[0];
      const found = alivePlayers.find((p) => p.name === nextStep.speaker);
      if (!found) {
        this._storySteps.shift();
        continue;
      }
      if (found.isHuman) {
        this._waitingForHumanName = found.name;
        this._storySteps.shift();
        return { speaker: null, storyStep: null };
      }
      this._storySteps.shift();
      return { speaker: found, storyStep: nextStep };
    }

    return {
      speaker: aliveAiPlayers[Math.floor(Math.random() * aliveAiPlayers.length)],
      storyStep: null,
    };
  }

  // 次のスピーカーの発言を1件以上生成して返す
  // 戻り値: [{ name, talk, coRole, vote, status, verdictWhite, verdictBlack }, ...] | null
  async generateNext() {
    const gs = this.gameState;
    const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

    // バックグラウンド準備中の場合は完了まで待機
    while (this._isPreparingNext) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 既に準備された投稿がある場合はそれを返す
    if (this._nextPreparedPosts && this._nextPreparedPosts.length > 0) {
      const posts = this._nextPreparedPosts;
      this._nextPreparedPosts = null;
      // バックグラウンドで次の投稿を準備開始（今返した投稿を未反映として渡す）
      this._prepareNextInBackground(posts);
      return posts;
    }

    const { speaker, storyStep } = await this._determineSpeaker();
    if (!speaker) return null;

    if (!aiApiKey) {
      return [this._fallback(speaker)];
    }

    const systemPrompt = this._buildSystemPrompt(speaker);
    const userPrompt = this._buildUserPrompt(speaker, storyStep);
    const fullPrompt = systemPrompt + '\n\n' + userPrompt;

    try {
      const responseText = await callAI(fullPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 2000,
        reasoningEffort,
      });
      const posts = this._parseResponse(responseText, speaker);
      // バックグラウンドで次の投稿を準備開始（今返した投稿を未反映として渡す）
      this._prepareNextInBackground(posts);
      return posts;
    } catch (e) {
      console.warn(`精度向上モード発言生成エラー (${speaker.name}):`, e);
      return [this._fallback(speaker)];
    }
  }

  // バックグラウンドで次の投稿を準備
  async _prepareNextInBackground(previouslyReturnedPosts = null) {
    // 既に準備中または準備済みの場合は何もしない
    if (this._isPreparingNext || this._nextPreparedPosts) return;
    
    // フラグを即座に設定して競合を防ぐ
    this._isPreparingNext = true;
    
    try {
      const gs = this.gameState;
      const { aiApiKey, aiModel, reasoningEffort } = gs.settings;

      const { speaker, storyStep } = await this._determineSpeaker();
      if (!speaker) {
        return;
      }

      if (!aiApiKey) {
        this._nextPreparedPosts = [this._fallback(speaker)];
        return;
      }

      const systemPrompt = this._buildSystemPrompt(speaker);
      // previouslyReturnedPosts は直前に generateNext() で返された投稿で、
      // まだ bbsLog に反映されていない未反映の投稿として扱う
      const userPrompt = this._buildUserPrompt(speaker, storyStep, previouslyReturnedPosts);
      const fullPrompt = systemPrompt + '\n\n' + userPrompt;

      const responseText = await callAI(fullPrompt, aiApiKey, aiModel, {
        jsonMode: true,
        maxTokens: 2000,
        reasoningEffort,
      });
      this._nextPreparedPosts = this._parseResponse(responseText, speaker);
    } catch (e) {
      console.warn('バックグラウンド発言生成エラー:', e);
      this._nextPreparedPosts = null;
    } finally {
      this._isPreparingNext = false;
    }
  }

  _buildSystemPrompt(speaker) {
    const gs = this.gameState;
    const role = speaker.role;
    const isWolf = isActualWolf(role);
    const teammates = isWolf
      ? gs.players
          .filter((p) => isActualWolf(p.role) && p.id !== speaker.id)
          .map((p) => p.name)
          .join('、')
      : '';
    const roomLevel = gs.settings.roomLevel || 'intermediate';
    const roomLevelPrompt = ROOM_LEVELS[roomLevel]?.prompt || '';
    const sharedPartner = role?.id === ROLES.SHARED.id
      ? (gs.players.find((p) => p.id !== speaker.id && p.role?.id === ROLES.SHARED.id)?.name || null)
      : null;
    return buildPrecisionSystemPrompt(speaker, teammates, roomLevelPrompt, sharedPartner);
  }

  _buildUserPrompt(speaker, storyStep = null, unreflectedPosts = null) {
    const gs = this.gameState;
    const role = speaker.role;
    const isWolf = isActualWolf(role);
    const isSeer = role?.id === ROLES.SEER.id;
    const isHunter = role?.id === ROLES.HUNTER.id;
    const isMedium = role?.id === ROLES.MEDIUM.id;

    // 自身を含む生存プレイヤー名
    const alivePlayersText = gs.getAlivePlayers()
      .map((p) => p.name)
      .join('、');

    const storyDirectionText = storyStep?.summary || '';

    const todayPosts = gs.getTodayPosts();

    // 人狼のみ人狼チャットを参照できる
    const wolfPosts = isWolf
      ? gs.bbsLog.filter((p) => p.day === gs.day && (p.type === 'wolf_chat' || p.type === 'whisper'))
      : [];

    // 占い師のみ占い結果（seerVerdict）を知っている
    const seerResults = isSeer
      ? gs.players
          .filter((p) => p.seerVerdict != null)
          .map((p) => ({ targetName: p.name, isWerewolf: p.seerVerdict === 'black' }))
      : [];

    // 騎士のみ前夜の護衛対象を知っている
    const hunterResult = (isHunter && speaker.lastGuardedId)
      ? (() => {
          const guarded = gs.getPlayer(speaker.lastGuardedId);
          return guarded ? { guardedName: guarded.name } : null;
        })()
      : null;

    // 霊媒師のみ処刑済みプレイヤーの役職を知っている
    const mediumResults = isMedium
      ? gs.players
          .filter((p) => !p.isAlive && p.deathReason === 'execution' && p.role)
          .map((p) => ({ targetName: p.name, isWerewolf: isSeerWerewolf(p.role) }))
      : [];

    const currentVotes = gs.getAlivePlayers()
      .filter((p) => gs.votes[p.id])
      .map((p) => {
        const target = gs.getPlayer(gs.votes[p.id]);
        return target ? { voterName: p.name, targetName: target.name } : null;
      })
      .filter(Boolean);

    return buildPrecisionSpeechUserPrompt({
      player: speaker,
      day: gs.day,
      alivePlayersText,
      storyDirectionText,
      previousDaysSynopsis: gs.previousDaysSynopsis || '',
      todayPosts,
      wolfPosts,
      seerResults,
      hunterResult,
      mediumResults,
      currentVotes,
      unreflectedPosts,
    });
  }

  _parseResponse(responseText, speaker) {
    try {
      // BatchConversationAI の JSON パーサーを再利用
      const batchAI = new BatchConversationAI(this.gameState);
      const data = batchAI._normalizeConversationJson(responseText);
      if (!Array.isArray(data.posts) || data.posts.length === 0) {
        throw new Error('posts が空です');
      }

      const aliveNames = new Set(this.gameState.getAlivePlayers().map((p) => p.name));

      // 発言者の全投稿を返す（連投対応）
      const results = data.posts.map((post) => {
        const statusValue = (typeof post.status === 'string' && VALID_PORTRAIT_STATUSES.has(post.status))
          ? post.status
          : 'default';
        const voteValue = post.target || post.vote;
        const verdictWhite = _normalizeVerdictNames(post.villager, aliveNames);
        const verdictBlack = _normalizeVerdictNames(post.werewolf, aliveNames);
        return {
          name: speaker.name,
          talk: (typeof post.talk === 'string' && post.talk.trim()) ? post.talk.trim() : null,
          coRole: (typeof post.coRole === 'string' && post.coRole.trim()) ? post.coRole.trim() : null,
          vote: (typeof voteValue === 'string' && aliveNames.has(voteValue) && voteValue !== speaker.name)
            ? voteValue : null,
          status: statusValue,
          verdictWhite,
          verdictBlack,
        };
      }).filter((p) => p.talk || p.coRole || p.vote);

      if (results.length === 0) throw new Error('有効な投稿がありません');
      return results;
    } catch (e) {
      // 途切れた出力から部分的に talk を抽出して投稿する
      const partial = this._tryExtractPartialResponse(responseText, speaker);
      if (partial) return partial;
      console.warn(`精度向上モード応答パースエラー (${speaker.name}):`, e, responseText);
      return [this._fallback(speaker)];
    }
  }

  // 途切れた JSON 出力から talk を部分抽出する
  // 成功時: [{ name, talk, ... }] を返す
  // 失敗時: null を返す
  _tryExtractPartialResponse(responseText, speaker) {
    if (!responseText || typeof responseText !== 'string') return null;
    const text = responseText.trim();
    if (!text) return null;

    // "talk": "..." を正規表現で抽出（文字列が途中で途切れていても可）
    const talkMatch = text.match(/"talk"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (!talkMatch || !talkMatch[1]) return null;
    const partialTalk = talkMatch[1].trim();
    if (!partialTalk) return null;

    return [{
      name: speaker.name,
      talk: partialTalk,
      coRole: null,
      vote: null,
      status: 'default',
      verdictWhite: [],
      verdictBlack: [],
    }];
  }

  _fallback(speaker) {
    const speeches = [
        `[会話情報の取得に失敗しました]`,
    ];
    return {
      name: speaker.name,
      talk: speeches[Math.floor(Math.random() * speeches.length)],
      coRole: null,
      vote: null,
      status: 'default',
      verdictWhite: [],
      verdictBlack: [],
    };
  }
}
