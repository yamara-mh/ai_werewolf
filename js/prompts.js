// LLMプロンプト定義
// このファイルでLLMに渡すすべてのプロンプトを管理します。
// プロンプトの文言を変更する場合はこのファイルを編集してください。

// ============================================================
// ロジックAI (LogicAI)
// ============================================================

const LOGIC_AI_SYSTEM_PROMPT =
  'あなたは人狼ゲームを観察するロジックAIです。村人の視点でチャットを分析し、' +
  '確定情報・役職予想・人狼ライン候補・推奨行動を簡潔に整理してください。日本語で出力してください。';

/**
 * @param {number} day
 * @param {string} alivePlayersText  生存プレイヤー名を読点区切りにした文字列
 * @param {string} deadPlayersText   死亡・処刑プレイヤー名を読点区切りにした文字列（なければ空文字）
 * @param {string} recentPostsText   直近の発言ログ（整形済み文字列）
 */
function buildLogicAiUserPrompt(day, alivePlayersText, deadPlayersText, recentPostsText) {
  return `現在: ${day}日目
生存プレイヤー: ${alivePlayersText}
${deadPlayersText ? `死亡・処刑: ${deadPlayersText}` : ''}
以下の形式で分析してください：
【確定情報】役職COした人物・死亡者など
【役職予想】各プレイヤーの役職予想と根拠
【人狼ライン候補】人狼の可能性が高いプレイヤーと理由
【推奨行動】村人陣営として取るべき行動

チャットログ（最近の発言）:
${recentPostsText || '（発言なし）'}`;
}

// ============================================================
// 個別AIプレイヤー (AIPlayer)
// ============================================================

/**
 * @param {string}  name            AIプレイヤーの名前
 * @param {string}  personality     性格・スタイル
 * @param {object}  role            役職オブジェクト { name, description }
 * @param {boolean} isWolf          人狼陣営かどうか
 * @param {string}  teammates       仲間の人狼名（人狼陣営のみ、なければ空文字）
 * @param {string}  roomLevelPrompt 部屋レベルの補足指示（なければ空文字）
 * @param {string}  logicAiOutput   ロジックAIの分析結果（なければ空文字）
 */
function buildAiPlayerSystemPrompt(name, personality, role, isWolf, teammates, roomLevelPrompt, logicAiOutput) {
  const lines = [
    'あなたは人狼ゲームのAIプレイヤーです。',
    `名前: ${name}`,
    `性格・スタイル: ${personality}`,
    `役職: ${role?.name || '不明'}（${role?.description || ''}）`,
    `チーム: ${isWolf ? '人狼陣営' : '村人陣営'}`,
  ];
  if (isWolf && teammates) lines.push(`仲間の人狼: ${teammates}`);
  if (roomLevelPrompt) lines.push(roomLevelPrompt);
  lines.push('ゲームの現在の状況に基づいて、あなたのキャラクターとして自然な日本語で短く（1〜3文）発言してください。');
  lines.push('役職は絶対に明かさないでください（占い師が公開する場合を除く）。');
  lines.push('ゲームを楽しく盛り上げるよう心がけてください。');
  if (logicAiOutput) lines.push(`\nあなたの思考（ロジック分析）:\n${logicAiOutput}`);
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
// バッチ会話生成AI (BatchConversationAI)
// ============================================================

const BATCH_CONVERSATION_SYSTEM_PROMPT =
  '人狼ゲームの進行AIです。登場人物たちの会話を、指定されたJSON形式で生成してください。';

const BATCH_VOTE_SYSTEM_PROMPT =
  '人狼ゲームの進行AIです。投票フェーズにおける各キャラクターの投票先と発言を、指定されたJSON形式で生成してください。';

// --- チャット履歴フォーマットヘルパー ---

function _escapeForPrompt(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

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

// --- バッチ会話プロンプト ---

/**
 * 昼フェーズの会話続きを生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelPrompt  部屋レベルの補足指示
 * @param {Array}    params.alivePlayers     生存AIプレイヤー配列 [{name, role, personality}]
 * @param {Array}    params.publicPosts      公開チャット履歴（最新50件）
 * @param {Array}    params.wolfPosts        人狼チャット履歴
 * @param {string}   params.logicAiOutput    前回のロジックAI出力
 * @param {string}   params.targetNames      発言を生成するプレイヤー名（読点区切り）
 */
function buildBatchConversationUserPrompt({ roomLevelPrompt, alivePlayers, publicPosts, wolfPosts, logicAiOutput, targetNames }) {
  const lines = [];

  lines.push('人狼ゲームのチャット履歴を見て会話の続きを生成してください。');
  lines.push('');

  if (roomLevelPrompt) {
    lines.push('# 備考');
    lines.push(roomLevelPrompt);
    lines.push('');
  }

  lines.push('# 登場人物');
  alivePlayers.forEach(({ name, role, personality }) => {
    lines.push(`## ${name}`);
    lines.push(`役職：${role?.name || '村人'}`);
    if (personality) lines.push(`性格・スタイル：${personality}`);
  });
  lines.push('');

  lines.push('# チャット履歴');
  publicPosts.forEach((post) => lines.push(_formatPost(post)));
  lines.push('');

  if (wolfPosts.length > 0) {
    lines.push('# 人狼チャット履歴');
    wolfPosts.forEach((post) => lines.push(_formatChatPostEntry(post)));
    lines.push('');
  }

  if (logicAiOutput) {
    lines.push('# 前回の状況整理');
    lines.push(logicAiOutput);
    lines.push('');
  }

  lines.push('# 生成対象プレイヤー');
  lines.push(`以下のプレイヤーたちの発言を生成してください：${targetNames}`);
  lines.push('目安として各プレイヤーが1〜2回発言するようにし、全員が最低1回は発言してください。');
  lines.push('');

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

// --- 投票フェーズプロンプト ---

/**
 * 投票フェーズでAI全員の投票先と発言を生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelPrompt  部屋レベルの補足指示
 * @param {Array}    params.targetPlayers    投票するAIプレイヤー配列 [{name, role, personality}]
 * @param {string}   params.candidateNames   生存プレイヤー名（読点区切り、投票候補）
 * @param {Array}    params.publicPosts      公開チャット履歴（最新50件）
 * @param {string}   params.logicAiOutput    前回のロジックAI出力
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
    if (personality) lines.push(`性格・スタイル：${personality}`);
  });
  lines.push('');

  lines.push('# 投票候補（生存プレイヤー）');
  lines.push(candidateNames);
  lines.push('');

  lines.push('# チャット履歴（議論の流れ）');
  publicPosts.forEach((post) => lines.push(_formatPost(post)));
  lines.push('');

  if (logicAiOutput) {
    lines.push('# 前回の状況整理');
    lines.push(logicAiOutput);
    lines.push('');
  }

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

// --- アドベンチャーモードプロンプト ---

/**
 * アドベンチャーモードでまとまった会話と投票変更を生成するためのユーザープロンプトを構築します。
 * @param {object}   params
 * @param {string}   params.roomLevelPrompt    部屋レベルの補足指示
 * @param {Array}    params.aiPlayersWithVotes  AIプレイヤー配列 [{name, role, personality, currentVote}]
 * @param {Array}    params.publicPosts         公開チャット履歴（最新50件）
 * @param {Array}    params.wolfPosts           人狼チャット履歴
 * @param {string}   params.logicAiOutput       前回のロジックAI出力
 * @param {Array}    params.currentVotes        現在の投票状況 [{voterName, targetName}]
 * @param {number}   params.targetCount         生成する発言数の目安
 */
function buildAdventureUserPrompt({ roomLevelPrompt, aiPlayersWithVotes, publicPosts, wolfPosts, logicAiOutput, currentVotes, targetCount }) {
  const lines = [];

  lines.push('人狼ゲームの続きの会話を生成してください。');
  lines.push('');

  if (roomLevelPrompt) {
    lines.push('# 備考');
    lines.push(roomLevelPrompt);
    lines.push('');
  }

  lines.push('# 登場人物');
  aiPlayersWithVotes.forEach(({ name, role, personality, currentVote }) => {
    lines.push(`## ${name}`);
    lines.push(`役職：${role?.name || '村人'}`);
    if (personality) lines.push(`性格・スタイル：${personality}`);
    if (currentVote) lines.push(`現在の投票先：${currentVote}`);
  });
  lines.push('');

  lines.push('# チャット履歴');
  publicPosts.forEach((post) => lines.push(_formatPost(post)));
  lines.push('');

  if (wolfPosts.length > 0) {
    lines.push('# 人狼チャット履歴');
    wolfPosts.forEach((post) => lines.push(_formatChatPostEntry(post)));
    lines.push('');
  }

  if (logicAiOutput) {
    lines.push('# 前回の状況整理');
    lines.push(logicAiOutput);
    lines.push('');
  }

  if (currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# 指示');
  lines.push(`上記の会話の続きを約${targetCount}発言生成してください。`);
  lines.push('登場人物たちは自然に会話を続けます。');
  lines.push('各キャラクターは任意のタイミングで投票先を決定・変更できます（vote フィールドを使用）。');
  lines.push('各キャラクターは任意のタイミングで役職をCOできます（coRole フィールドを使用）。');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('以下のJSON形式で出力してください：');
  lines.push(JSON.stringify({
    posts: [{ name: 'プレイヤー名', talk: '発言内容', coRole: '役職ID（省略可）', vote: '投票先プレイヤー名（省略可）' }],
    summary: { chat: '現在の会話状況のまとめ', prediction: '各プレイヤーの役職予想' },
  }, null, 2));
  lines.push(`coRole の値は次のいずれか（省略可）：villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push(`vote は投票先変更がある場合のみ設定（自分以外の生存者の名前、省略可）`);
  lines.push(`約${targetCount}発言になるよう生成してください。`);

  return lines.join('\n');
}
