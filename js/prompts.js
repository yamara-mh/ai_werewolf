// LLMプロンプト定義
// このファイルでLLMに渡すすべてのプロンプトを管理します。
// プロンプトの文言を変更する場合はこのファイルを編集してください。

// ============================================================
// 個別AIプレイヤー (AIPlayer) — 夜アクション専用
// ============================================================

/**
 * @param {string}  name            AIプレイヤーの名前
 * @param {string}  personality     性格（character）
 * @param {object}  role            役職オブジェクト { name, description }
 * @param {boolean} isWolf          人狼陣営かどうか
 * @param {string}  teammates       仲間の人狼名（人狼陣営のみ、なければ空文字）
 * @param {string}  roomLevelPrompt 部屋レベルの補足指示（なければ空文字）
 */
function buildAiPlayerSystemPrompt(name, personality, role, isWolf, teammates, roomLevelPrompt) {
  const lines = [
    'あなたは人狼ゲームのAIプレイヤーです。',
    `名前: ${name}`,
    `性格: ${personality}`,
    `役職: ${role?.name || '不明'}（${role?.description || ''}）`,
    `チーム: ${isWolf ? '人狼陣営' : '村人陣営'}`,
  ];
  if (isWolf && teammates) lines.push(`仲間の人狼: ${teammates}`);
  if (roomLevelPrompt) lines.push(roomLevelPrompt);
  lines.push('ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く発言してください。');
  return lines.join('\n');
}

/**
 * @param {string} name             AIプレイヤーの名前
 * @param {number} day              現在の日数
 * @param {string} phaseLabel       フェーズ名（例: "昼（議論）"）
 * @param {string} alivePlayersText 生存プレイヤー名を読点区切りにした文字列
 * @param {string} recentPostsText  直近の発言ログ（整形済み文字列）
 */
function buildAiPlayerSpeechUserPrompt(name, day, phaseLabel, alivePlayersText, recentPostsText) {
  return `現在: ${day}日目 ${phaseLabel}
生存プレイヤー: ${alivePlayersText}

最近の掲示板の発言:
${recentPostsText || '（まだ発言はありません）'}

あなた（${name}）の発言を1〜3文で生成してください。発言のみを出力してください。`;
}

/**
 * @param {number} day            現在の日数
 * @param {string} candidatesText 投票候補プレイヤー名を読点区切りにした文字列
 * @param {string} recentPostsText 直近の発言ログ（整形済み文字列）
 */
function buildAiPlayerVoteUserPrompt(day, candidatesText, recentPostsText) {
  return `現在: ${day}日目 投票フェーズ
投票可能なプレイヤー: ${candidatesText}

最近の発言:
${recentPostsText || '（発言なし）'}

誰に投票しますか？候補者の名前を一人だけ答えてください。`;
}

/**
 * @param {object} role           役職オブジェクト
 * @param {string} candidatesText 対象候補プレイヤー名を読点区切りにした文字列
 */
function buildAiPlayerNightActionUserPrompt(role, candidatesText) {
  let actionDesc = '夜のアクション対象を選んでください。';
  if (isWerewolfRole(role))      actionDesc = '今夜襲撃する村人を選んでください。';
  else if (role?.id === ROLES.SEER.id)   actionDesc = '今夜占うプレイヤーを選んでください。';
  else if (role?.id === ROLES.HUNTER.id) actionDesc = '今夜護衛するプレイヤーを選んでください。';

  return `夜フェーズです。${actionDesc}
対象プレイヤー: ${candidatesText}

対象の名前を一人だけ答えてください。`;
}

// ============================================================
// バッチ会話生成AI (BatchConversationAI) のシステムプロンプトと
// フォーマットヘルパーは以下に定義しています。
// ============================================================

// --- チャット履歴フォーマットヘルパー ---

function _escapeForPrompt(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * 1件の投稿をシンプルな JSON 1行に変換します。
 * システム投稿の playerName は "GM" として出力します。
 */
function _formatPostSimple(post) {
  const name = post.playerName === '★システム' ? 'GM' : post.playerName;
  const obj = { name, talk: post.content || '' };
  if (post.coRole) obj.coRole = post.coRole;
  return JSON.stringify(obj);
}

// 後方互換のため旧フォーマット関数も残す
function _formatSystemPostEntry(post) {
  return [
    '"system" : {',
    `    "message" : "${_escapeForPrompt(post.content)}",`,
    `    "date" : "${post.timestamp}"`,
    '}',
  ].join('\n');
}

function _formatChatPostEntry(post) {
  return [
    '"post" : {',
    `    "name" : "${_escapeForPrompt(post.playerName)}",`,
    `    "talk" : "${_escapeForPrompt(post.content)}",`,
    `    "date" : "${post.timestamp}"`,
    '}',
  ].join('\n');
}

function _formatPost(post) {
  return post.type === 'system' ? _formatSystemPostEntry(post) : _formatChatPostEntry(post);
}

// ============================================================
// あらすじ生成プロンプト (Synopsis)
// ============================================================

/**
 * 夜ターンに「前日までのあらすじ」を生成するためのユーザープロンプトを構築します。
 * @param {number} day             まとめる対象の日
 * @param {string} previousSynopsis 既存のあらすじ（なければ空文字）
 * @param {Array}  todayPosts       当日の公開チャット投稿配列
 */
function buildSynopsisUserPrompt(day, previousSynopsis, todayPosts) {
  const lines = [];

  lines.push('人狼ゲームのこれまでの出来事を簡潔にまとめてください。日本語でテキストのみ出力してください。');
  lines.push('');

  if (previousSynopsis) {
    lines.push('# これまでのあらすじ');
    lines.push(previousSynopsis);
    lines.push('');
  }

  lines.push(`# ${day}日目のチャット`);
  todayPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  lines.push('');

  lines.push(
    `上記の${day}日目の出来事を含む「前日までのあらすじ」を500文字程度でまとめてください。` +
    '推理の判断材料に利用します。'
  );

  return lines.join('\n');
}

// ============================================================
// バッチ会話生成AI (BatchConversationAI)
// ============================================================

// --- バッチ会話プロンプト ---

/**
 * 昼フェーズの会話続きを生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelLabel       部屋レベルのラベル（例: "初級者"）
 * @param {string}   params.roomLevelPrompt      部屋レベルの補足指示
 * @param {Array}    params.allPlayers           全生存プレイヤー配列 [{name, role, personality, firstPersonPronouns, speakingStyle}]
 * @param {string}   params.previousDaysSynopsis 前日までのあらすじ
 * @param {Array}    params.todayPosts           今日の公開チャット投稿配列
 * @param {Array}    params.wolfPosts            今日の人狼チャット投稿配列
 * @param {string}   params.targetNames          発言を生成するプレイヤー名（読点区切り）
 * @param {number}   params.targetCount          生成する発言数の目安
 */
function buildBatchConversationUserPrompt({ roomLevelLabel, roomLevelPrompt, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, targetNames, targetCount }) {
  return _buildChatPrompt({
    roomLevelLabel,
    roomLevelPrompt,
    allPlayers,
    previousDaysSynopsis,
    todayPosts,
    wolfPosts,
    currentVotes: [],
    targetCount: targetCount || 10,
    targetNames,
  });
}

// --- アドベンチャーモードプロンプト ---

/**
 * アドベンチャーモードでまとまった会話と投票変更を生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelLabel       部屋レベルのラベル（例: "初級者"）
 * @param {string}   params.roomLevelPrompt      部屋レベルの補足指示
 * @param {Array}    params.allPlayers           全生存プレイヤー配列 [{name, role, personality, firstPersonPronouns, speakingStyle, currentVote}]
 * @param {string}   params.previousDaysSynopsis 前日までのあらすじ
 * @param {Array}    params.todayPosts           今日の公開チャット投稿配列
 * @param {Array}    params.wolfPosts            今日の人狼チャット投稿配列
 * @param {Array}    params.currentVotes         現在の投票状況 [{voterName, targetName}]
 * @param {number}   params.targetCount          生成する発言数の目安
 */
function buildAdventureUserPrompt({ roomLevelLabel, roomLevelPrompt, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes, targetCount }) {
  return _buildChatPrompt({
    roomLevelLabel,
    roomLevelPrompt,
    allPlayers,
    previousDaysSynopsis,
    todayPosts,
    wolfPosts,
    currentVotes,
    targetCount,
    targetNames: null,
  });
}

/**
 * 昼フェーズ共通のプロンプトビルダー（バッチ会話・アドベンチャー兼用）
 */
function _buildChatPrompt({ roomLevelLabel, roomLevelPrompt, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes, targetCount, targetNames }) {
  const lines = [];

  const roomPrefix = roomLevelLabel ? `${roomLevelLabel}による` : '';
  lines.push(`${roomPrefix}人狼ゲームの今日のチャットの続き${targetCount}ポストを、必ずjson形式で出力してください。`);
  lines.push('登場人物は talk の情報を頼りに思考するため、誤った推論をすることがあります。');

  if (roomLevelPrompt) {
    lines.push(roomLevelPrompt);
    lines.push('');
  }

  lines.push('# 登場人物の名前、役職、性格');
  const shuffledPlayers = [...allPlayers];
  for (let i = shuffledPlayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
  }
  shuffledPlayers.forEach(({ name, role, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    if (isHuman) {
      lines.push(`役職：${role?.name || '村人'}`);
      lines.push('この人物のセリフは私が担当します。絶対に発言を生成しないでください。');
    } else {
      lines.push(`役職：${role?.name || '村人'}`);
      if (personality) lines.push(`性格：${personality}`);
      if (firstPersonPronouns) lines.push(`一人称：${firstPersonPronouns}`);
      if (speakingStyle) lines.push(`話し方：${speakingStyle}`);
      if (currentVote) lines.push(`現在の投票先：${currentVote}`);
    }
  });
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  lines.push('# 今日のチャット');
  todayPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  lines.push('');

  if (wolfPosts && wolfPosts.length > 0) {
    lines.push('# 人狼チャット');
    wolfPosts.forEach((post) => lines.push(_formatPostSimple(post)));
    lines.push('');
  }

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  if (targetNames) {
    lines.push('# 生成対象プレイヤー');
    lines.push(`以下のプレイヤーたちの発言を生成してください：${targetNames}`);
    lines.push('');
  }

  lines.push('# 留意点');
  lines.push('占い師は初日、白判定になる人物を無作為に一人伝えられます。');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('全員が投票したら会議は終了します。');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('以下のJSON形式で出力してください：');
  lines.push(JSON.stringify({
    posts: [{ name: 'プレイヤー名', coRole: 'カミングアウトする役職ID（省略可）', thinking: '思考内容（省略可）', talk: '発言内容（省略可）', status: '表情', villager: [{ name: '白だしするプレイヤー名の配列（省略可）' }], werewolf: ['黒だしするプレイヤー名の配列（省略可）'], vote: '投票先プレイヤー名（省略可）' }],
  }, null, 2));
  lines.push(`coRole の値は次のいずれか（省略可）：villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push(`status の値は次のいずれか：default, smile, smug, laugh, serious, thinking, annoyed, surprised, panicking, sad, embarrassed`);
  lines.push('vote は投票先変更がある場合のみ設定（自分以外の生存者の名前、省略可）');

  return lines.join('\n');
}
