// AI プレイヤーロジック
// LogicAI（局面分析）と AIPlayer（個別プレイヤー発言・投票・夜アクション）を提供します

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
