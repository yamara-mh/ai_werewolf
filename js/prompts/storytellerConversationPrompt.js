// ストーリーテラーAI用プロンプト
// 依存: js/prompts/helpers.js (_formatPostSimple, _formatWolfPostSimple)

function buildStorytellerConversationPrompt({ day, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes }) {
  const lines = [];
  const toSpeakerName = (post) => (post.playerName === '★システム' ? 'GM' : post.playerName);
  const formatPublicPost = typeof _formatPostSimple === 'function'
    ? _formatPostSimple
    : (post) => JSON.stringify({ name: toSpeakerName(post), talk: post.content || '' });
  const formatWolfPost = typeof _formatWolfPostSimple === 'function'
    ? _formatWolfPostSimple
    : (post) => JSON.stringify({ name: toSpeakerName(post), werewolfOnlySecretTalk: post.content || '' });

  lines.push('あなたは人狼ゲームの監督です。');
  lines.push('今日のチャットの先の展開を予想し、JSONで結果を生成してください。');
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

  lines.push('# 今日のチャット');
  if (allTodayPosts.length > 0) {
    allTodayPosts.forEach(({ post, isWolf }) => {
      lines.push(isWolf ? formatWolfPost(post) : formatPublicPost(post));
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

  lines.push('# 出力の補足');
  lines.push('name は必ず生存者のみになります。');
  lines.push('{#私}は沈黙する体で展開を予想してください。');
  lines.push('thinking と talk はそれぞれ5～30文字前後で、冷静で論理的な体言止めにしてください。');

  lines.push('# 出力形式');
  lines.push(JSON.stringify({
    scenario: [
      { thinking: '次の発言者を予想する考察'},
      { name: '人物名', talk: '発言' },
      { thinking: '次の発言者を予想する考察'},
      { name: '人物名', talk: '発言' },
    ],
  }, null, 2));
  lines.push('');

  return lines.join('\n');
}
