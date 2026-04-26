/**
 * プレイヤー投稿プロパティ付与プロンプト
 * 
 * @description
 * プレイヤーの投稿内容を受け取り、coRole, vote, villager, werewolf を付与したTOONを返す
 * 
 * @purpose
 * 人間プレイヤーの自然な会話投稿から、ゲームの構造化データ（CO、投票、白だし、黒だし）を
 * 自動的に抽出し、UIの簡素化とプレイ体験の向上を実現する
 * 
 * @usage
 * ```javascript
 * const prompt = buildPlayerPropertyPrompt({
 *   player: humanPlayer,
 *   content: "私は占い師です。Aさんは人狼でした。Bさんに投票します。",
 *   day: 2,
 *   alivePlayersText: "A、B、C、D",
 *   // ... その他のパラメータ
 * });
 * const result = await callAI(prompt, apiKey, model);
 * // => decodeToon(result) => { coRole: "seer", vote: "B", villager: [], werewolf: ["A"] }
 * ```
 * 
 * @output TOON 形式（JSON フォールバックあり）
 * coRole: string | null  // カミングアウトする役職ID（例: "seer", "werewolf"）
 * vote: string | null    // 投票先プレイヤー名
 * villager[N]: プレイヤー名（カンマ区切り）  // 白だしプレイヤー名
 * werewolf[N]: プレイヤー名（カンマ区切り）  // 黒だしプレイヤー名
 * 
 * @dependencies
 * - js/config.js (ROLES, isActualWolf)
 * - js/toon.js (formatMixedPostsAsToon)
 */

/**
 * プレイヤー投稿にプロパティを付与するプロンプトを構築します。
 * @param {object} params
 * @param {object} params.player             投稿したプレイヤー
 * @param {string} params.content            投稿内容
 * @param {number} params.day                現在の日数
 * @param {string} params.alivePlayersText   生存プレイヤー名（読点区切り）
 * @param {string} params.previousDaysSynopsis 前日までのあらすじ
 * @param {Array}  params.todayPosts         今日の公開チャット投稿配列
 * @param {Array}  params.wolfPosts          今日の人狼チャット投稿配列（人狼のみ参照可）
 * @param {Array}  params.seerResults        占い師の占い結果配列（占い師のみ参照可）
 * @param {object|null} params.hunterResult  騎士の護衛結果（騎士のみ参照可）
 * @param {Array}  params.mediumResults      霊媒師の霊媒結果配列（霊媒師のみ参照可）
 * @param {Array}  params.currentVotes       現在の投票状況
 */
function buildPlayerPropertyPrompt({ player, content, day, alivePlayersText, previousDaysSynopsis, todayPosts, wolfPosts, seerResults, hunterResult, mediumResults, currentVotes }) {
  const lines = [];
  const role = player.role;
  const isWolf = isActualWolf(role);
  const isFox = role?.id === ROLES.FOX.id;
  const teamLabel = isWolf ? '人狼陣営' : (isFox ? '妖狐陣営' : '村人陣営');

  lines.push('あなたは人狼ゲームの発言内容を解析し、TOONを生成するアシスタントです。');
  lines.push('プレイヤーの発言内容から、カミングアウト（CO）、投票先、白だし、黒だしを抽出してください。');
  lines.push('');

  lines.push('# プレイヤー情報');
  lines.push(`名前: ${player.name}`);
  lines.push(`役職: ${role?.name || '不明'}（${role?.description || ''}）`);
  lines.push(`チーム: ${teamLabel}`);
  if (player.personality) lines.push(`性格: ${player.personality}`);
  if (player.firstPersonPronouns) lines.push(`一人称: ${player.firstPersonPronouns}`);
  if (player.speakingStyle) lines.push(`話し方: ${player.speakingStyle}`);
  lines.push('');

  lines.push('# 生存プレイヤー');
  lines.push(alivePlayersText || 'なし');
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  lines.push('# 今日のチャット');
  const allTodayPosts = [
    ...todayPosts.map((p) => ({ post: p, isWolf: false })),
    ...(wolfPosts || []).map((p) => ({ post: p, isWolf: true })),
  ].sort((a, b) => (a.post.id || 0) - (b.post.id || 0));
  if (allTodayPosts.length > 0) {
    lines.push(formatMixedPostsAsToon(allTodayPosts));
  } else {
    lines.push('（まだ発言はありません）');
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

  lines.push('# プレイヤーの発言内容');
  lines.push(content);
  lines.push('');

  lines.push('# 抽出指示');
  lines.push('以下の情報を発言内容から抽出してください:');
  lines.push('- coRole: カミングアウト（CO）している役職ID（省略可）');
  lines.push('  - 可能な値: villager, seer, medium, hunter, madman, werewolf, shared, cat, fox');
  lines.push('- vote: 投票先のプレイヤー名（省略可）');
  lines.push('- villager: 白だし（村人判定）したプレイヤー名（省略可、複数はカンマ区切り）');
  lines.push('- werewolf: 黒だし（人狼判定）したプレイヤー名（省略可、複数はカンマ区切り）');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('必ず以下の TOON 形式に従って出力してください:');
  lines.push(
    'coRole: カミングアウトする役職ID（省略可）\n' +
    'vote: 投票先プレイヤー名（省略可）\n' +
    'villager[N]: 白だしするプレイヤー名（省略可、複数はカンマ区切り）\n' +
    'werewolf[N]: 黒だしするプレイヤー名（省略可、複数はカンマ区切り）'
  );
  lines.push('');
  lines.push('発言内容に該当する情報がない場合は、そのフィールドを省略してください。');

  return lines.join('\n');
}
