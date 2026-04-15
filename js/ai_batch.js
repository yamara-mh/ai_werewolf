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
