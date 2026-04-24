// ストーリーテラーAI用プロンプト
// 依存: js/prompts/helpers.js (_formatPostSimple, _formatWolfPostSimple)

function buildStorytellerConversationPrompt({ day, allPlayers, previousDaysSynopsis, todayPosts, wolfPosts, currentVotes }) {
  const lines = [];

  lines.push('あなたは人狼ゲームのストーリーテラーです。');
  lines.push('今日の会議が投票完了までどう進むか、端的で簡潔なシナリオをJSONで作成してください。');
  lines.push('発言順が分かることを最優先し、summary は短い日本語で書いてください。');
  lines.push('人間プレイヤーも speaker に含めて構いません。');
  lines.push('');

  lines.push('# 今日');
  lines.push(`day ${day}`);
  lines.push('');

  lines.push('# プレイヤー一覧');
  allPlayers.forEach(({ name, role, isAlive, isHuman, personality, firstPersonPronouns, speakingStyle, currentVote }) => {
    lines.push(`## ${name}`);
    lines.push(`役職: ${role?.name || '不明'}`);
    lines.push(`生存: ${isAlive ? '生存' : '死亡'}`);
    lines.push(`操作: ${isHuman ? '人間' : 'AI'}`);
    if (personality) lines.push(`性格: ${personality}`);
    if (firstPersonPronouns) lines.push(`一人称: ${firstPersonPronouns}`);
    if (speakingStyle) lines.push(`話し方: ${speakingStyle}`);
    if (currentVote) lines.push(`現在の投票先: ${currentVote}`);
  });
  lines.push('');

  lines.push('# 前日までのあらすじ');
  lines.push(previousDaysSynopsis || 'なし');
  lines.push('');

  lines.push('# 今日の公開チャット');
  if (todayPosts.length > 0) {
    todayPosts.forEach((post) => lines.push(_formatPostSimple(post)));
  } else {
    lines.push('（まだ発言はありません）');
  }
  lines.push('');

  if (wolfPosts && wolfPosts.length > 0) {
    lines.push('# 今日の人狼チャット');
    wolfPosts.forEach((post) => lines.push(_formatWolfPostSimple(post)));
    lines.push('');
  }

  if (currentVotes && currentVotes.length > 0) {
    lines.push('# 現在の投票状況');
    currentVotes.forEach(({ voterName, targetName }) => lines.push(`${voterName} → ${targetName}`));
    lines.push('');
  }

  lines.push('# 出力形式');
  lines.push(JSON.stringify({
    scenario: [
      { speaker: 'プレイヤー名', summary: '短い発言要約' },
      { speaker: 'プレイヤー名', summary: '短い発言要約' },
    ],
  }, null, 2));
  lines.push('');
  lines.push('scenario はこのあとの想定順に並べること。');
  lines.push('speaker は必ず実在するプレイヤー名にすること。');
  lines.push('summary は10〜25文字程度の短い日本語にすること。');

  return lines.join('\n');
}
