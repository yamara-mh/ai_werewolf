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
 * @param {string|null} sharedPartner 共有者の場合、仲間の共有者名（それ以外は null）
 */
function buildPrecisionSystemPrompt(player, teammates, roomLevelPrompt, sharedPartner) {
  const role = player.role;
  const isWolf = isActualWolf(role);
  const isFox = role?.id === ROLES.FOX.id;
  const teamLabel = isWolf ? '人狼陣営' : (isFox ? '妖狐陣営' : '村人陣営');
  const lines = [
    'あなたは人狼ゲームのプレイヤーです。',
    '{#今日のチャット}の続きを投稿してください。',
    '必ずJSON形式で出力してください。',
  ];
  if (roomLevelPrompt) lines.push(roomLevelPrompt);
  lines.push('');
  lines.push(`# あなたの情報`);
  lines.push(`名前: ${player.name}`);
  lines.push(`役職: ${role?.name || '不明'}（${role?.description || ''}）`);
  lines.push(`チーム: ${teamLabel}`);
  if (player.personality)           lines.push(`性格: ${player.personality}`);
  if (player.firstPersonPronouns)   lines.push(`一人称: ${player.firstPersonPronouns}`);
  if (player.speakingStyle)         lines.push(`話し方: ${player.speakingStyle}`);
  if (isWolf && teammates)          lines.push(`仲間の人狼: ${teammates}`);
  if (sharedPartner)                lines.push(`仲間の共有者: ${sharedPartner}`);
  return lines.join('\n');
}

/**
 * 会話精度向上モードで1人分の発言を生成するユーザープロンプトを構築します。
 * @param {object} params
 * @param {object} params.player             発言するプレイヤー
 * @param {number} params.day                現在の日数
 * @param {string} params.alivePlayersText   生存プレイヤー名（読点区切り、自分を含む）
 * @param {string} params.storyDirectionText ストーリーテラーAIが想定した今回の発言要約
 * @param {string} params.previousDaysSynopsis 前日までのあらすじ
 * @param {Array}  params.todayPosts         今日の公開チャット投稿配列
 * @param {Array}  params.wolfPosts          今日の人狼チャット投稿配列（人狼のみ参照可）
 * @param {Array}  params.seerResults        占い師の占い結果配列 [{targetName, isWerewolf}]（占い師のみ参照可）
 * @param {object|null} params.hunterResult  騎士の護衛結果 {guardedName}（騎士のみ参照可）
 * @param {Array}  params.mediumResults      霊媒師の霊媒結果配列 [{targetName, isWerewolf}]（霊媒師のみ参照可）
 * @param {Array}  params.currentVotes       現在の投票状況 [{voterName, targetName}]
 * @param {Array}  params.unreflectedPosts   前回生成されたがまだチャットに反映されていない投稿配列（省略可）
 */
function buildPrecisionSpeechUserPrompt({ player, day, alivePlayersText, storyDirectionText, previousDaysSynopsis, todayPosts, wolfPosts, seerResults, hunterResult, mediumResults, currentVotes, unreflectedPosts }) {
  const lines = [];

  lines.push('# 生存プレイヤー');
  lines.push(alivePlayersText || 'なし');
  lines.push('');

  lines.push('# 留意点');
  lines.push('占い師は初日、白判定になる人物を無作為に一人告げられます。');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('全員が投票したら会議は終了します。');
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  if (storyDirectionText) {
    lines.push('# ストーリーテラーの進行案');
    lines.push(`${player.name}: ${storyDirectionText}`);
    lines.push('');
  }

  lines.push('# 今日のチャット');
  // 人狼チャット（werewolfOnlySecretTalk）を通常チャットに混合して時系列で表示
  // wolfPosts は人狼（大狼）のみ受け取る。それ以外は空配列
  const allTodayPosts = [
    ...todayPosts.map((p) => ({ post: p, isWolf: false })),
    ...(wolfPosts || []).map((p) => ({ post: p, isWolf: true })),
  ].sort((a, b) => (a.post.id || 0) - (b.post.id || 0));
  
  const hasUnreflectedPosts = unreflectedPosts && Array.isArray(unreflectedPosts) && unreflectedPosts.length > 0;
  
  if (allTodayPosts.length > 0) {
    allTodayPosts.forEach(({ post, isWolf }) => {
      lines.push(isWolf ? _formatWolfPostSimple(post) : _formatPostSimple(post));
    });
  } else if (!hasUnreflectedPosts) {
    lines.push('（まだ発言はありません）');
  }
  
  // 未反映の投稿（前回生成されたがまだチャットに反映されていない投稿）も含める
  // 注: unreflectedPosts は _parseResponse の戻り値で、bbsLog とは異なる構造
  // { name, talk, coRole, ... } という形式なので、直接 JSON.stringify する
  if (hasUnreflectedPosts) {
    unreflectedPosts.forEach((post) => {
      if (post.talk) {
        const obj = { name: post.name, talk: post.talk };
        if (post.coRole) obj.coRole = post.coRole;
        lines.push(JSON.stringify(obj));
      }
    });
  }
  
  lines.push('');

  if (seerResults && seerResults.length > 0) {
    lines.push('# 占い結果');
    seerResults.forEach(({ targetName, isWerewolf }) => {
      lines.push(`${targetName}: ${isWerewolf ? '人狼' : '人狼ではない'}`);
    });
    lines.push('');
  }

  if (hunterResult) {
    lines.push('# 護衛結果（前夜）');
    lines.push(`${hunterResult.guardedName} を護衛しました`);
    lines.push('');
  }

  if (mediumResults && mediumResults.length > 0) {
    lines.push('# 霊媒結果');
    mediumResults.forEach(({ targetName, isWerewolf }) => {
      lines.push(`${targetName}: ${isWerewolf ? '人狼' : '人狼ではない'}`);
    });
    lines.push('');
  }

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('');
  lines.push('# 出力の補足');
  lines.push(`coRole の値は次のいずれか（省略可）: villager, seer, medium, hunter, madman, werewolf, shared, cat, fox`);
  lines.push(`status の値は次のいずれか: default, smile, smug, laugh, serious, thinking, annoyed, surprised, panicking, sad, embarrassed`);
  lines.push('vote は投票先変更がある場合のみ設定（省略可）');
  lines.push('villager, werewolf は役職持ちが明確に白だし（黒だし）した場合のみ設定する。');
  lines.push('post の配列数は発言の情報量や性格に応じて1～5回ほどにする。');

  lines.push('# 出力形式');
  lines.push('必ず以下のJSON形式に従って出力してください:');
  lines.push(JSON.stringify({
    posts: [{ name: 'プレイヤー名（必須）', thinking: '冷静な分析（省略可）', coRole: 'カミングアウトする役職ID（省略可）', talk: '発言内容（必須。10～30文字）', status: '表情（必須）', villager: { name: '白だしするプレイヤー名（省略可）' }, werewolf: { name: '黒だしするプレイヤー名（省略可）' }, vote: '投票先プレイヤー名（省略可）' },
      { name: 'プレイヤー名', talk: '発言内容（10～30文字）', status: '表情' }
    ],
  }, null, 2));

  return lines.join('\n');
}
