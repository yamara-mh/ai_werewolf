// ゲーム設定・役職定義

const ROLES = {
  VILLAGER: {
    id: 'villager',
    name: '村人',
    team: 'village',
    description: '特殊能力はありません。昼の議論と投票で人狼を追放してください。',
    icon: '👤',
  },
  WEREWOLF: {
    id: 'werewolf',
    name: '人狼',
    team: 'werewolf',
    description: '毎晩、村人を一人襲撃できます。昼間は村人のふりをしてください。',
    icon: '🐺',
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
  BAKER: {
    id: 'baker',
    name: 'パン屋',
    team: 'village',
    description: '村人陣営。特別な夜行動はありません。',
    icon: '🥖',
  },
  FOX: {
    id: 'fox',
    name: '妖狐',
    team: 'village',
    description: '村人陣営として扱われます。特別な夜行動はありません。',
    icon: '🦊',
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
  WHITE_WOLF: {
    id: 'white_wolf',
    name: '白狼',
    team: 'werewolf',
    description: '人狼陣営。夜に村人を襲撃できます。',
    icon: '🐺',
  },
  MADMAN: {
    id: 'madman',
    name: '狂人',
    team: 'werewolf',
    description: '人狼の仲間です。役職は村人に見えますが、人狼チームの勝利を目指します。',
    icon: '🃏',
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

const OPTIONAL_ROLE_ORDER = [
  ROLES.SEER.id,
  ROLES.MEDIUM.id,
  ROLES.HUNTER.id,
  ROLES.BAKER.id,
  ROLES.FOX.id,
  ROLES.SHARED.id,
  ROLES.CAT.id,
  ROLES.WHITE_WOLF.id,
];

function isWerewolfRole(role) {
  return role?.team === TEAMS.WEREWOLF;
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

const AI_PERSONALITIES = [
  { name: 'アリス', style: '論理的・慎重' },
  { name: 'ボブ',   style: '積極的・直感的' },
  { name: 'キャロル', style: '観察力が高い・穏やか' },
  { name: 'デイブ', style: '疑い深い・挑発的' },
  { name: 'エヴァ', style: 'フレンドリー・協調的' },
  { name: 'フランク', style: '寡黙・分析的' },
  { name: 'グレース', style: '感情的・共感的' },
];

const GAME_STORAGE_KEY = 'ai_werewolf_game_state';
