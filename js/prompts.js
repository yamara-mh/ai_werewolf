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
  lines.push('ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く（1〜3文）発言してください。');
  lines.push('役職は絶対に明かさないでください（占い師が公開する場合を除く）。');
  lines.push('ゲームを楽しく盛り上げるよう心がけてください。');
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

const SYNOPSIS_SYSTEM_PROMPT =
  '人狼ゲームのこれまでの出来事を簡潔にまとめてください。日本語でテキストのみ出力してください。';

/**
 * 夜ターンに「前日までのあらすじ」を生成するためのユーザープロンプトを構築します。
 * @param {number} day             まとめる対象の日
 * @param {string} previousSynopsis 既存のあらすじ（なければ空文字）
 * @param {Array}  todayPosts       当日の公開チャット投稿配列
 */
function buildSynopsisUserPrompt(day, previousSynopsis, todayPosts) {
  const lines = [];

  if (previousSynopsis) {
    lines.push('# これまでのあらすじ');
    lines.push(previousSynopsis);
    lines.push('');
  }

  lines.push(`# ${day}日目のチャット`);
  todayPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  lines.push('');

  lines.push(
    `上記の${day}日目の出来事を含む「前日までのあらすじ」を200文字程度でまとめてください。` +
    '翌日のゲームプレイヤーへのブリーフィングとして使用します。'
  );

  return lines.join('\n');
}

// ============================================================
// バッチ会話生成AI (BatchConversationAI)
// ============================================================

const BATCH_CONVERSATION_SYSTEM_PROMPT =
  '人狼ゲームの進行AIです。登場人物たちの会話を、指定されたJSON形式で生成してください。';

const BATCH_VOTE_SYSTEM_PROMPT =
  '人狼ゲームの進行AIです。投票フェーズにおける各キャラクターの投票先と発言を、指定されたJSON形式で生成してください。';

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

// --- 投票フェーズプロンプト ---

/**
 * 投票フェーズでAI全員の投票先と発言を生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelPrompt  部屋レベルの補足指示
 * @param {Array}    params.targetPlayers    投票するAIプレイヤー配列 [{name, role, personality}]
 * @param {string}   params.candidateNames   生存プレイヤー名（読点区切り、投票候補）
 * @param {Array}    params.publicPosts      公開チャット履歴（最新50件）
 * @param {string}   params.logicAiOutput    前回の状況整理テキスト
 */
function buildBatchVoteUserPrompt({ roomLevelPrompt, targetPlayers, candidateNames, publicPosts, logicAiOutput }) {
  const lines = [];

  lines.push('投票フェーズです。各キャラクターが誰に投票するかを決め、投票宣言の発言を生成してください。');
  lines.push('');

  if (roomLevelPrompt) {
    lines.push('# 備考');
    lines.push(roomLevelPrompt);
    lines.push('');
  }

  lines.push('# 登場人物（投票権あり）');
  targetPlayers.forEach(({ name, role, personality }) => {
    lines.push(`## ${name}`);
    lines.push(`役職：${role?.name || '村人'}`);
    if (personality) lines.push(`性格：${personality}`);
  });
  lines.push('');

  lines.push('# 投票候補（生存プレイヤー）');
  lines.push(candidateNames);
  lines.push('');

  lines.push('# チャット履歴（議論の流れ）');
  publicPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  lines.push('');

  if (logicAiOutput) {
    lines.push('# 前回の状況整理');
    lines.push(logicAiOutput);
    lines.push('');
  }

  lines.push('# 出力形式');
  lines.push('以下のJSON形式で出力してください：');
  lines.push(JSON.stringify({
    votes: [{ name: 'プレイヤー名', thinking: '投票理由（内部思考）', vote: '投票先プレイヤー名', talk: '投票宣言の発言' }],
  }, null, 2));
  lines.push('vote は投票候補の中から必ず一人を選んでください（自分自身は不可）。');
  lines.push('talk は「○○に投票します」のような投票宣言の発言です。');
  lines.push('全員が必ず一票を投じてください。');

  return lines.join('\n');
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
  lines.push('');

  if (roomLevelPrompt) {
    lines.push('# 備考');
    lines.push(roomLevelPrompt);
    lines.push('');
  }

  lines.push('# 登場人物の名前、役職、性格');
  allPlayers.forEach(({ name, role, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    if (isHuman) {
      lines.push('役職：村人');
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

  lines.push('# ポストの種類');
  lines.push('## 発言');
  lines.push('{ "name" : "プレイヤー名", "talk" : "発言内容" }');
  lines.push('## カミングアウト');
  lines.push('{ "name" : "プレイヤー名", "coRole" : "seer" }');
  lines.push('## 行動（投票／占い／防衛／襲撃）');
  lines.push('{ "name" : "プレイヤー名", "target" : "投票先プレイヤー名" }');
  lines.push('');

  lines.push('# 留意点');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('生存者の過半数が投票したら会議は終了します。');
  lines.push('必ずjson形式で出力してください。');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('以下のJSON形式で出力してください：');
  lines.push(JSON.stringify({
    posts: [{ name: 'プレイヤー名', talk: '発言内容（省略可）', coRole: '役職ID（省略可）', target: '投票先プレイヤー名（省略可）' }],
    summary: { chat: '現在の会話状況のまとめ', prediction: '各プレイヤーの役職予想' },
  }, null, 2));
  lines.push(`coRole の値は次のいずれか（省略可）：villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push('target は投票先変更がある場合のみ設定（自分以外の生存者の名前、省略可）');

  return lines.join('\n');
}
