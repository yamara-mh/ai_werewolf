// 会話精度向上モード用プロンプト（PrecisionConversationAI）
// キャラクターが知り得る情報だけを用いて1発言ずつ生成します。
// 依存: js/config.js (ROLES, isActualWolf, isSeerWerewolf)
//       js/prompts/helpers.js (_formatPostSimple)

/**
 * 会話精度向上モードで1人分の発言を生成するシステムプロンプトを構築します。
 * @param {object} player            発言するプレイヤー
 * @param {string} player.name
 * @param {object} player.role
 * @param {string} player.personality
 * @param {string} player.firstPersonPronouns
 * @param {string} player.speakingStyle
 * @param {string} teammates         仲間の人狼名（人狼陣営のみ）
 * @param {string} roomLevelPrompt   部屋レベルの補足指示
 */
function buildPrecisionSystemPrompt(player, teammates, roomLevelPrompt) {
  const role = player.role;
  const isWolf = isActualWolf(role);
  const lines = [
    'あなたは人狼ゲームのAIプレイヤーです。',
    `名前: ${player.name}`,
    `役職: ${role?.name || '不明'}（${role?.description || ''}）`,
    `チーム: ${isWolf ? '人狼陣営' : '村人陣営'}`,
  ];
  if (player.personality)           lines.push(`性格: ${player.personality}`);
  if (player.firstPersonPronouns)   lines.push(`一人称: ${player.firstPersonPronouns}`);
  if (player.speakingStyle)         lines.push(`話し方: ${player.speakingStyle}`);
  if (isWolf && teammates)          lines.push(`仲間の人狼: ${teammates}`);
  if (roomLevelPrompt)              lines.push(roomLevelPrompt);
  lines.push('あなたが知り得る情報だけを根拠に、キャラクターとして自然な日本語で発言してください。');
  return lines.join('\n');
}

/**
 * 会話精度向上モードで1人分の発言を生成するユーザープロンプトを構築します。
 * @param {object} params
 * @param {object} params.player             発言するプレイヤー
 * @param {number} params.day                現在の日数
 * @param {string} params.alivePlayersText   生存プレイヤー名（読点区切り、自分除く）
 * @param {string} params.previousDaysSynopsis 前日までのあらすじ
 * @param {Array}  params.todayPosts         今日の公開チャット投稿配列
 * @param {Array}  params.wolfPosts          今日の人狼チャット投稿配列（人狼のみ参照可）
 * @param {Array}  params.seerResults        占い師の占い結果配列 [{targetName, isWerewolf}]（占い師のみ参照可）
 * @param {Array}  params.currentVotes       現在の投票状況 [{voterName, targetName}]
 */
function buildPrecisionSpeechUserPrompt({ player, day, alivePlayersText, previousDaysSynopsis, todayPosts, wolfPosts, seerResults, currentVotes }) {
  const lines = [];

  lines.push(`人狼ゲームの ${day}日目 昼（議論）フェーズです。`);
  lines.push('あなたの発言を1件、必ず json 形式で出力してください。');
  lines.push('talk はこまめに区切り、冗長な発言は控えてください。');
  lines.push('');

  lines.push('# 生存プレイヤー（あなた以外）');
  lines.push(alivePlayersText || 'なし');
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  lines.push('# 今日のチャット');
  if (todayPosts && todayPosts.length > 0) {
    todayPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  } else {
    lines.push('（まだ発言はありません）');
  }
  lines.push('');

  if (wolfPosts && wolfPosts.length > 0) {
    lines.push('# 人狼チャット（あなたのみ閲覧可能）');
    wolfPosts.forEach((post) => lines.push(_formatPostSimple(post)));
    lines.push('');
  }

  if (seerResults && seerResults.length > 0) {
    lines.push('# あなたの占い結果（あなたのみ知っている）');
    seerResults.forEach(({ targetName, isWerewolf }) => {
      lines.push(`${targetName}: ${isWerewolf ? '🐺 人狼' : '✅ 人狼ではない'}`);
    });
    lines.push('');
  }

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# 留意点');
  lines.push('占い師は初日、白判定になる人物を無作為に一人伝えられます。');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('以下のJSON形式で1件だけ出力してください：');
  lines.push(JSON.stringify({
    posts: [{ name: player.name, coRole: 'カミングアウトする役職ID（省略可）', talk: '発言内容', status: '表情', villager: [{ name: '白だしするプレイヤー名の配列（省略可）' }], werewolf: ['黒だしするプレイヤー名の配列（省略可）'], vote: '投票先プレイヤー名（省略可）' }],
  }, null, 2));
  lines.push(`coRole の値は次のいずれか（省略可）：villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push(`status の値は次のいずれか：default, smile, smug, laugh, serious, thinking, annoyed, surprised, panicking, sad, embarrassed`);
  lines.push('vote は投票先変更がある場合のみ設定（自分以外の生存者の名前、省略可）');
  lines.push('villager・werewolf は占い師・霊媒師・狩人をCOして明確に白だし（黒だし）する場合のみ設定する。');

  return lines.join('\n');
}
