// ストーリーテラーAI用プロンプト
// 依存: js/prompts/helpers.js (_formatPostSimple, _formatWolfPostSimple)

function buildStorytellerConversationPrompt({ day, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes, unreflectedPosts }) {
  const lines = [];
  const toSpeakerName = (post) => (post.playerName === '★システム' ? 'GM' : post.playerName);
  const formatPublicPost = typeof _formatPostSimple === 'function'
    ? _formatPostSimple
    : (post) => JSON.stringify({ name: toSpeakerName(post), talk: post.content || '' });
  const formatWolfPost = typeof _formatWolfPostSimple === 'function'
    ? _formatWolfPostSimple
    : (post) => JSON.stringify({ name: toSpeakerName(post), werewolfOnlySecretTalk: post.content || '' });

  lines.push('あなたは人狼ゲームの脚本家です。');
  lines.push('今日のチャットの続きとなる scenario を8件考えてください。');
  lines.push('論理的で面白いシナリオを心がけてください。');
  lines.push('');

  lines.push('# 人物一覧');
  allPlayers.forEach(({ name, role, isAlive, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    lines.push(`役職: ${role?.name || '不明'}`);
    lines.push(`生存: ${isAlive ? '生存' : '死亡'}`);
    if (isHuman) lines.push(`※この人物は{#私}です`);
    if (personality) lines.push(`個性: ${personality}`);
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
    allTodayPosts.forEach(({ post, isWolf }) => {
      lines.push(isWolf ? formatWolfPost(post) : formatPublicPost(post));
    });
  } else if (!hasUnreflectedPosts) {
    lines.push('（まだ発言はありません）');
  }
  
  // 未反映の投稿（前回生成されたがまだチャットに反映されていない投稿）も含める
  if (hasUnreflectedPosts) {
    unreflectedPosts.forEach((post) => {
      if (post.talk) {
        lines.push(`${post.name}: ${post.talk}`);
      }
    });
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
  lines.push('冷静で水平思考な体言止めの文章を心がけてください。');

  lines.push('# 出力形式');
  lines.push(JSON.stringify({
    scenario: [
      { situation: '状況解説', thinking:'戦略', name: '人物名', summary: '発言概要' },
      { situation: '状況解説', thinking:'戦略', name: '人物名', summary: '発言概要' },
    ],
  }, null, 2));
  lines.push('');

  return lines.join('\n');
}
