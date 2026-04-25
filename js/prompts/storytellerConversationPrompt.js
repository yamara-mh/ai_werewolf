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

  lines.push('あなたは人狼ゲームのストーリーテラーです。');
  lines.push('今日の会議で投票が完了するまでのシナリオをJSONで作成してください。');
  lines.push('{#私}が操作する人物は沈黙する体で話を進めてください。');
  lines.push('');

  lines.push('# 人物一覧');
  allPlayers.forEach(({ name, role, isAlive, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    lines.push(`役職: ${role?.name || '不明'}`);
    lines.push(`生存: ${isAlive ? '生存' : '死亡'}`);
    if (isHuman) lines.push(`※この人物の発言は{#私}が担当します。`);
    if (personality) lines.push(`性格: ${personality}`);
    if (currentVote) lines.push(`現在の投票先: ${currentVote}`);
  });
  lines.push('');

  lines.push('# 留意点');
  lines.push('占い師は初日、白判定になる人物を無作為に一人告げられます。');
  lines.push('会議中いつでも投票、再投票できます。');
  lines.push('全員が投票したら会議は終了します。');
  lines.push('');

  lines.push('# 人狼の心得');
  lines.push('占い師は初日、白判定になる人物を無作為に一人告げられます。');
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  lines.push('# 今日のチャット');
  if (todayPosts.length > 0) {
    todayPosts.forEach((post) => lines.push(formatPublicPost(post)));
  } else {
    lines.push('（まだ発言はありません）');
  }
  lines.push('');

  if (wolfPosts && wolfPosts.length > 0) {
    lines.push('# 今日の人狼チャット');
    wolfPosts.forEach((post) => lines.push(formatWolfPost(post)));
    lines.push('');
  }

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# 出力の補足');
  lines.push('name は必ず生存者にすること。');
  lines.push('{#私}が操作する人物は沈黙する体で話を進めること。');
  lines.push('## 発言の要約の例');
  lines.push('私が占い師。タロウは白');
  lines.push('ジロウは初日からハナコを疑っていたので白目');
  lines.push('');

  lines.push('# 出力形式');
  lines.push(JSON.stringify({
    scenario: [
      { name: '人物名', summary: '発言の要約' },
      { name: '人物名', summary: '発言の要約' },
    ],
  }, null, 2));
  lines.push('');

  return lines.join('\n');
}
