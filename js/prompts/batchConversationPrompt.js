// バッチ会話生成プロンプト（BatchConversationAI）
// 依存: js/prompts/helpers.js (_formatPostSimple)

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
    posts: [{ name: 'プレイヤー名', coRole: 'カミングアウトする役職ID（省略可）', strategy: '戦略を簡潔に記述（省略可）', talk: '発言内容（省略可）', status: '表情', villager: [{ name: '白だしするプレイヤー名の配列（省略可）' }], werewolf: ['黒だしするプレイヤー名の配列（省略可）'], vote: '投票先プレイヤー名（省略可）' }],
  }, null, 2));
  lines.push(`coRole の値は次のいずれか（省略可）：villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push(`status の値は次のいずれか：default, smile, smug, laugh, serious, thinking, annoyed, surprised, panicking, sad, embarrassed`);
  lines.push('vote は投票先変更がある場合のみ設定（自分以外の生存者の名前、省略可）');
  lines.push('villager・werewolf は、プレイヤーが占い師・霊媒師・狩人をCOして「[名前]は白（黒）」と明確に白だし（黒だし）する発言をした場合のみ設定する');

  return lines.join('\n');
}
