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

// プリセット構成 (players count -> roles)
const ROLE_PRESETS = {
  4: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER, ROLES.WEREWOLF],
  5: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER, ROLES.WEREWOLF],
  6: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER, ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.MADMAN],
  7: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER, ROLES.MEDIUM, ROLES.WEREWOLF, ROLES.WEREWOLF],
  8: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER, ROLES.MEDIUM, ROLES.HUNTER, ROLES.WEREWOLF, ROLES.WEREWOLF],
};

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
