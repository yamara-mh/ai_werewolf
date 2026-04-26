// ゲーム設定・役職定義

const ROLES = {
  VILLAGER: {
    id: 'villager',
    name: '村人',
    team: 'village',
    description: '特殊能力はありません。昼の議論と投票で人狼を追放してください。',
    icon: '👤',
  },
  SEER: {
    id: 'seer',
    name: '占い師',
    team: 'village',
    description: '毎晩、一人のプレイヤーの役職（人狼かどうか）を占えます。',
    icon: '🔮',
  },
  MEDIUM: {
    id: 'medium',
    name: '霊媒師',
    team: 'village',
    description: '処刑されたプレイヤーの役職が分かります。',
    icon: '🪬',
  },
  HUNTER: {
    id: 'hunter',
    name: '騎士',
    team: 'village',
    description: '毎晩、一人のプレイヤーを人狼の襲撃から守れます。',
    icon: '🛡️',
  },
  MADMAN: {
    id: 'madman',
    name: '狂人',
    team: 'werewolf',
    description: '人狼の仲間です。役職は村人に見えますが、人狼チームの勝利を目指します。',
    icon: '🤪',
  },
  WEREWOLF: {
    id: 'werewolf',
    name: '人狼',
    team: 'werewolf',
    description: '毎晩、村人を一人襲撃できます。昼間は村人のふりをしてください。',
    icon: '🐺',
  },
  SHARED: {
    id: 'shared',
    name: '共有者',
    team: 'village',
    description: '村人陣営。特別な夜行動はありません。',
    icon: '🤝',
  },
  CAT: {
    id: 'cat',
    name: '猫又',
    team: 'village',
    description: '村人陣営。特別な夜行動はありません。',
    icon: '🐈',
  },
  FOX: {
    id: 'fox',
    name: '妖狐',
    team: 'village',
    description: '村人陣営として扱われます。特別な夜行動はありません。',
    icon: '🦊',
  },
  WHITE_WOLF: {
    id: 'white_wolf',
    name: '大狼',
    team: 'werewolf',
    description: '人狼陣営。夜に村人を襲撃できます。占いでは人間判定、霊媒では人狼判定される。',
    icon: '🐺',
  },
};

const GAME_PHASES = {
  SETUP: 'setup',
  MORNING: 'morning',   // 朝のアナウンス
  DAY: 'day',           // 昼の議論
  VOTE: 'vote',         // 投票
  EXECUTION: 'execution', // 処刑
  NIGHT: 'night',       // 夜のアクション
  END: 'end',           // ゲーム終了
};

const TEAMS = {
  VILLAGE: 'village',
  WEREWOLF: 'werewolf',
};

const ROLE_DISPLAY_ORDER = [
  ROLES.VILLAGER.id,
  ROLES.SEER.id,
  ROLES.MEDIUM.id,
  ROLES.HUNTER.id,
  ROLES.MADMAN.id,
  ROLES.WEREWOLF.id,
  ROLES.SHARED.id,
  ROLES.CAT.id,
  ROLES.FOX.id,
  ROLES.WHITE_WOLF.id,
];

const OPTIONAL_ROLE_ORDER = [
  ROLES.SEER.id,
  ROLES.MEDIUM.id,
  ROLES.HUNTER.id,
  ROLES.MADMAN.id,
  ROLES.SHARED.id,
  ROLES.CAT.id,
  ROLES.FOX.id,
  ROLES.WHITE_WOLF.id,
];

function isWerewolfRole(role) {
  return role?.team === TEAMS.WEREWOLF;
}

// 占い師の判定上「人狼」と出るか（大狼は人間判定のため除外）
function isSeerWerewolf(role) {
  return role?.id === ROLES.WEREWOLF.id;
}

// 実際の人狼かどうか（狂人を除く）
function isActualWolf(role) {
  return role?.id === ROLES.WEREWOLF.id || role?.id === ROLES.WHITE_WOLF.id;
}

function buildRoleDeck(totalPlayers, werewolfCount, optionalRoleIds = []) {
  const total = Number(totalPlayers) || 8;
  const requestedWolves = Number(werewolfCount) || 1;
  const maxWolves = Math.max(1, total - 1);
  const wolfCount = Math.min(Math.max(requestedWolves, 1), maxWolves);
  const requested = new Set(optionalRoleIds);
  const roleById = Object.values(ROLES).reduce((map, role) => {
    map[role.id] = role;
    return map;
  }, {});

  const selected = OPTIONAL_ROLE_ORDER.filter((roleId) => requested.has(roleId));

  const roles = Array.from({ length: wolfCount }, () => ROLES.WEREWOLF);
  let villagers = Math.max(0, total - roles.length);

  for (const roleId of selected) {
    if (villagers <= 0) break;
    if (roleId === ROLES.WHITE_WOLF.id) {
      const wolfIndex = roles.findIndex((role) => role.id === ROLES.WEREWOLF.id);
      if (wolfIndex >= 0) {
        roles[wolfIndex] = ROLES.WHITE_WOLF;
      }
      continue;
    }

    const role = roleById[roleId];
    if (!role) continue;

    // 共有者は2人1組で追加
    if (roleId === ROLES.SHARED.id) {
      if (villagers >= 2) {
        roles.push(role, role);
        villagers -= 2;
      }
      continue;
    }

    roles.push(role);
    villagers -= 1;
  }

  while (roles.length < total) {
    roles.push(ROLES.VILLAGER);
  }

  return roles;
}

// personality/PromptSheet.tsv から読み込んだデータで上書きされます（フォールバック用）
let AI_PERSONALITIES = [
  { name: 'ムライ',  personality: '堅物',    firstPersonPronouns: '某',      speakingStyle: '古語。である調' },
  { name: 'シノブ',  personality: '快活',    firstPersonPronouns: '拙者',    speakingStyle: '古語。ござる調' },
  { name: 'レイ',    personality: '強がり',  firstPersonPronouns: '我',      speakingStyle: '難解。である調' },
  { name: 'ルナピ',  personality: '無気力',  firstPersonPronouns: 'アタシ',  speakingStyle: 'くだけた口調。語尾を伸ばす' },
  { name: 'サマヨ',  personality: '高飛車',  firstPersonPronouns: 'ワタクシ', speakingStyle: '強気。ですわ調' },
  { name: 'ヒョウタ', personality: '臆病',   firstPersonPronouns: 'おいら',  speakingStyle: '弱気。吃音' },
  { name: 'マサオ',  personality: '自信家',  firstPersonPronouns: '僕',     speakingStyle: '簡潔にハッキリと話す' },
];

/**
 * personality/PromptSheet.tsv を取得・解析して AI_PERSONALITIES を上書きします。
 * @param {string} [tsvPath='personality/PromptSheet.tsv']
 * @returns {Promise<boolean>} 読み込み成功なら true
 */
async function loadPersonalitiesFromTsv(tsvPath = 'personality/PromptSheet.tsv') {
  try {
    const res = await fetch(tsvPath);
    if (!res.ok) return false;
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return false;
    // 1行目はヘッダー（name\tpersonality\tindividuality\tfirstPersonPronouns\tspeakingStyle）
    const headers = lines[0].split('\t').map((header) => header.trim());
    const parsed = lines.slice(1).map((line) => {
      const values = line.split('\t');
      const row = headers.reduce((acc, header, index) => {
        acc[header] = values[index] || '';
        return acc;
      }, {});
      const name = (row.name || '').trim();
      const personality = (row.personality || row.individuality || row.character || '').trim();
      if (!name || !personality) return null;
      return {
        name,
        personality,
        individuality: (row.individuality || '').trim(),
        firstPersonPronouns: (row.firstPersonPronouns || '').trim(),
        speakingStyle: (row.speakingStyle || '').trim(),
      };
    }).filter(Boolean);
    if (parsed.length === 0) return false;
    AI_PERSONALITIES = parsed;
    return true;
  } catch (e) {
    console.warn('PromptSheet.tsv の読み込みに失敗しました', e);
    return false;
  }
}

const GAME_STORAGE_KEY = 'ai_werewolf_game_state';

const ROOM_LEVELS = {
  tutorial:     { label: 'チュートリアル', prompt: '初めて人狼ゲームをプレイする方のために、用語やセオリーを解説しながら分かりやすく議論してください。' },
  beginner:     { label: '初級者',         prompt: '初級者向けに、分かりやすい推理と丁寧な議論を心がけてください。' },
  intermediate: { label: '中級者',         prompt: '' },
  advanced:     { label: '上級者',         prompt: '上級者として高度な論理と深い戦略で議論を進めてください。' },
};
