// あらすじ生成プロンプト (Synopsis)
// 依存: js/prompts/helpers.js (_formatPostSimple)

/**
 * 夜ターンに「前日までのあらすじ」を生成するためのユーザープロンプトを構築します。
 * @param {number} day             まとめる対象の日
 * @param {string} previousSynopsis 既存のあらすじ（なければ空文字）
 * @param {Array}  todayPosts       当日の公開チャット投稿配列
 */
function buildSynopsisUserPrompt(day, previousSynopsis, todayPosts) {
  const lines = [];

  lines.push('人狼ゲームのこれまでの出来事を簡潔にまとめてください。日本語でテキストのみ出力してください。');
  lines.push('');

  if (previousSynopsis) {
    lines.push('# これまでのあらすじ');
    lines.push(previousSynopsis);
    lines.push('');
  }

  lines.push(`# ${day}日目のチャット`);
  lines.push(formatPublicPostsAsToon(todayPosts));
  lines.push('');

  lines.push(
    `上記の${day}日目の出来事を含む「前日までのあらすじ」を500文字程度でまとめてください。` +
    '推理の判断材料に利用します。'
  );

  return lines.join('\n');
}
