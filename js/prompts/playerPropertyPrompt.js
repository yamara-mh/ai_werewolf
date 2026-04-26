/**
 * プレイヤー投稿プロパティ付与プロンプト
 * 
 * @description
 * プレイヤーの投稿内容を受け取り、coRole, vote, villager, werewolf を付与したJSONを返す
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
 * const result = await callAI(prompt, apiKey, model, { jsonMode: true });
 * // => { coRole: "seer", vote: "B", villager: [], werewolf: ["A"] }
 * ```
 * 
 * @output
 * {
 *   coRole: string | null,  // カミングアウトする役職ID（例: "seer", "werewolf"）
 *   vote: string | null,     // 投票先プレイヤー名
 *   villager: string[],      // 白だし（村人判定）したプレイヤー名の配列
 *   werewolf: string[]       // 黒だし（人狼判定）したプレイヤー名の配列
 * }
 * 
 * @dependencies
 * - js/config.js (ROLES, isActualWolf)
 * - js/prompts/helpers.js (_formatPostSimple, _formatWolfPostSimple)
 */

/**
 * プレイヤー投稿にプロパティを付与するプロンプトを構築します。
 * @param {object} params
 * @param {object} params.player                 投稿したプレイヤー
 * @param {string} params.content                投稿内容
 * @param {number} params.day                    現在の日数
 * @param {string} params.alivePlayersText       生存プレイヤー名（読点区切り）
 * @param {string} params.executedPlayersText    処刑されたプレイヤー名（読点区切り）
 * @param {string} params.attackedPlayersText    襲撃されたプレイヤー名（読点区切り）
 * @param {string} params.previousDaysSynopsis   前日までのあらすじ
 * @param {Array}  params.todayPosts             今日の公開チャット投稿配列
 * @param {Array}  params.seerResults            占い師の占い結果配列（占い師のみ参照可）
 * @param {object|null} params.hunterResult      騎士の護衛結果（騎士のみ参照可）
 * @param {Array}  params.mediumResults          霊媒師の霊媒結果配列（霊媒師のみ参照可）
 * @param {Array}  params.currentVotes           現在の投票状況
 */
function buildPlayerPropertyPrompt({ player, content, day, alivePlayersText, executedPlayersText, attackedPlayersText, previousDaysSynopsis, todayPosts, seerResults, hunterResult, mediumResults, currentVotes }) {
  const lines = [];
  const role = player.role;
  const isWolf = isActualWolf(role);
  const isFox = role?.id === ROLES.FOX.id;
  const teamLabel = isWolf ? '人狼陣営' : (isFox ? '妖狐陣営' : '村人陣営');

  lines.push('あなたは人狼ゲームの発言内容を解析し、JSONを生成するアシスタントです。');
  lines.push('プレイヤーの発言内容から、カミングアウト（CO）、投票先、白だし、黒だしを行ったか判断してください。');
  lines.push('');

  lines.push('# 生存プレイヤー');
  lines.push(alivePlayersText || 'なし');
  lines.push('');

  lines.push('# 処刑されたプレイヤー');
  lines.push(executedPlayersText || 'なし');
  lines.push('');

  lines.push('# 襲撃されたプレイヤー');
  lines.push(attackedPlayersText || 'なし');
  lines.push('');

  lines.push('# 直近のチャット');
  const recentPosts = todayPosts.slice(-3);
  if (recentPosts.length > 0) {
    recentPosts.forEach((post) => {
      const toSpeakerName = (p) => (p.playerName === '★システム' ? 'GM' : p.playerName);
      const formatPost = (p) => JSON.stringify({ name: toSpeakerName(p), talk: p.content || '' });
      lines.push(formatPost(post));
    });
  } else {
    lines.push('（まだ発言はありません）');
  }
  lines.push('');

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# プレイヤーの発言内容');
  lines.push(content);
  lines.push('');

  lines.push('# 出力の補足');
  lines.push('以下の情報を発言内容から抽出してください:');
  lines.push('- coRole: カミングアウト（CO）した役職ID（省略可）');
  lines.push('  - 可能な値: villager, seer, medium, hunter, madman, werewolf, shared, cat, fox');
  lines.push('- vote: 投票先の人物名（省略可）');
  lines.push('- villager: 白だし（村人判定）した人物名の配列（省略可）');
  lines.push('- werewolf: 黒だし（人狼判定）した人物名の配列（省略可）');
  lines.push('');

  lines.push('# 出力形式');
  lines.push('必ず以下のJSON形式に従って出力してください:');
  lines.push(JSON.stringify({
    coRole: 'カミングアウトした役職ID（省略可）',
    vote: '投票先の人物名（省略可）',
    villager: ['白だしした人物名（省略可）'],
    werewolf: ['黒だしした人物名（省略可）'],
  }, null, 2));
  lines.push('');
  lines.push('発言内容に該当する情報がない場合は、そのフィールドを省略してください。');

  return lines.join('\n');
}
