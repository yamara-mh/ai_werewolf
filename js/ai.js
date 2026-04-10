// AI プレイヤーロジック
// OpenAI API (または互換API) を使用してAIプレイヤーの発言・行動を生成します

class AIPlayer {
  constructor(gameState) {
    this.gameState = gameState;
  }

  // AIプレイヤーの発言を生成
  async generateSpeech(aiPlayer) {
    const gs = this.gameState;
    const { aiApiKey, aiModel } = gs.settings;

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildSpeechPrompt(aiPlayer);

    if (!aiApiKey) {
      return this._fallbackSpeech(aiPlayer);
    }

    try {
      const response = await this._callAPI(systemPrompt, userPrompt, aiApiKey, aiModel);
      return response;
    } catch (e) {
      console.warn(`AI発言生成エラー (${aiPlayer.name}):`, e);
      return this._fallbackSpeech(aiPlayer);
    }
  }

  // AIプレイヤーの投票先を決定
  async decideVote(aiPlayer) {
    const gs = this.gameState;
    const { aiApiKey, aiModel } = gs.settings;
    const alivePlayers = gs.getAlivePlayers().filter((p) => p.id !== aiPlayer.id);

    if (!aiApiKey || alivePlayers.length === 0) {
      return this._fallbackVote(aiPlayer, alivePlayers);
    }

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildVotePrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await this._callAPI(systemPrompt, userPrompt, aiApiKey, aiModel);
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
    const { aiApiKey, aiModel } = gs.settings;
    const humanPlayer = gs.getHumanPlayer();

    // 人狼は人間以外の村人を優先して狙う（またはAI村人）
    const alivePlayers = gs.getAlivePlayers().filter((p) => p.id !== aiPlayer.id);
    if (alivePlayers.length === 0) return null;

    if (!aiApiKey) {
      return this._fallbackNightAction(aiPlayer, alivePlayers);
    }

    const systemPrompt = this._buildSystemPrompt(aiPlayer);
    const userPrompt = this._buildNightActionPrompt(aiPlayer, alivePlayers);

    try {
      const responseText = await this._callAPI(systemPrompt, userPrompt, aiApiKey, aiModel);
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
    const isWolf = role?.team === TEAMS.WEREWOLF;
    const teammates = isWolf
      ? gs.players
          .filter((p) => p.role?.team === TEAMS.WEREWOLF && p.id !== aiPlayer.id)
          .map((p) => p.name)
          .join('、')
      : '';

    return `あなたは人狼ゲームのAIプレイヤーです。
名前: ${aiPlayer.name}
性格・スタイル: ${aiPlayer.personality}
役職: ${role?.name || '不明'}（${role?.description || ''}）
チーム: ${isWolf ? '人狼陣営' : '村人陣営'}
${isWolf && teammates ? `仲間の人狼: ${teammates}` : ''}

ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く（1〜3文）発言してください。
役職は絶対に明かさないでください（占い師が公開する場合を除く）。
ゲームを楽しく盛り上げるよう心がけてください。`;
  }

  _buildSpeechPrompt(aiPlayer) {
    const gs = this.gameState;
    const recentPosts = gs.bbsLog.slice(-10).map(
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
    const recentPosts = gs.bbsLog.slice(-15).map(
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
    if (role?.id === ROLES.WEREWOLF.id) actionDesc = '今夜襲撃する村人を選んでください。';
    else if (role?.id === ROLES.SEER.id) actionDesc = '今夜占うプレイヤーを選んでください。';
    else if (role?.id === ROLES.HUNTER.id) actionDesc = '今夜護衛するプレイヤーを選んでください。';
    else actionDesc = '夜のアクション対象を選んでください。';

    return `夜フェーズです。${actionDesc}
対象プレイヤー: ${candidates.map((p) => p.name).join('、')}

対象の名前を一人だけ答えてください。`;
  }

  // --- APIコール ---

  async _callAPI(systemPrompt, userPrompt, apiKey, model) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.8,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`API Error ${res.status}: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  // --- フォールバック（APIなし時） ---

  _fallbackSpeech(aiPlayer) {
    const role = aiPlayer.role;
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
    if (aiPlayer.role?.id === ROLES.WEREWOLF.id) {
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
