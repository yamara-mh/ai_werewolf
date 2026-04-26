// ストーリーテラーAI用プロンプト
// 依存: js/toon.js (formatMixedPostsAsToon, formatUnreflectedPostsAsToon)

function buildStorytellerConversationPrompt({ day, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes, unreflectedPosts }) {
  const lines = [];

  lines.push('あなたは人狼ゲームの監督です。');
  lines.push('今日のチャットの先の展開を予想し、TOONで結果を生成してください。');
  lines.push('論理的で面白い予想を心がけ、投票完了まで予想し切ってください。');
  lines.push('');

  lines.push('# 人物一覧');
  allPlayers.forEach(({ name, role, isAlive, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    lines.push(`役職: ${role?.name || '不明'}`);
    lines.push(`生存: ${isAlive ? '生存' : '死亡'}`);
    if (isHuman) lines.push(`※この人物は{#私}です`);
    if (personality) lines.push(`性格: ${personality}`);
    if (currentVote) lines.push(`現在の投票先: ${currentVote}`);
  });
  lines.push('');

  lines.push('# 留意点');
  lines.push('占い師は初日、白判定になる人物を無作為に一人告げられます。');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('全員が投票したら会議は終了します。');
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  // 人狼チャット（werewolfOnlySecretTalk）を通常チャットに混合して時系列で表示
  const allTodayPosts = [
    ...todayPosts.map((p) => ({ post: p, isWolf: false })),
    ...(wolfPosts || []).map((p) => ({ post: p, isWolf: true })),
  ].sort((a, b) => (a.post.id || 0) - (b.post.id || 0));

  const hasUnreflectedPosts = unreflectedPosts && Array.isArray(unreflectedPosts) && unreflectedPosts.length > 0;
  
  lines.push('# 今日のチャット');
  if (allTodayPosts.length > 0) {
    lines.push(formatMixedPostsAsToon(allTodayPosts));
  } else if (!hasUnreflectedPosts) {
    lines.push('（まだ発言はありません）');
  }
  
  // 未反映の投稿（前回生成されたがまだチャットに反映されていない投稿）も含める
  // 注: unreflectedPosts は _parseResponse の戻り値で、bbsLog とは異なる構造
  // { name, talk, coRole, ... } という形式
  if (hasUnreflectedPosts) {
    lines.push(formatUnreflectedPostsAsToon(unreflectedPosts));
  }
  
  lines.push('');

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# 出力の補足');
  lines.push('name は必ず生存者のみになります。');
  lines.push('予想の中では、{#私}は沈黙すると仮定してください。');
  lines.push('thinking, talk はそれぞれ5～30文字前後で、冷静で論理的な体言止めにしてください。');

  lines.push('# 出力形式');
  lines.push(
    'scenario[N]:\n' +
    '  - thinking: 次の発言者と立ち回りの考察\n' +
    '  - name: 人物名\n' +
    '    talk: 発言\n' +
    '  - thinking: 考察\n' +
    '  - name: 人物名\n' +
    '    talk: 発言'
  );
  lines.push('');

  return lines.join('\n');
}
