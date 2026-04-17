// BBS・プレイヤー表示ユーティリティ
// 役職アイコン解決・プレイヤー名HTML生成・HTML エスケープ

// 役職IDから役職オブジェクトを高速に引ける静的マップ
const ROLE_BY_ID = Object.values(ROLES).reduce((map, role) => {
  map[role.id] = role;
  return map;
}, {});

// プレイヤー名の表示HTML（役職COアイコン・仲間アンダーライン）を一元生成
function buildPlayerNameHtml(name, {
  coRole = null,
  isAlly = false,
  fallbackRoleId = ROLES.VILLAGER.id,
  breakLine = false,
} = {}) {
  const roleObj = (coRole ? ROLE_BY_ID[coRole] : null)
    || ROLE_BY_ID[fallbackRoleId]
    || ROLES.VILLAGER;
  const roleIcon = roleObj?.icon || ROLES.VILLAGER.icon;
  const separator = breakLine ? '<br />' : ' ';
  // 仲間（ally）の場合はCOカラーを付けない、それ以外はcoRoleに基づくカラークラスを付ける
  const colorClass = (!isAlly && coRole) ? ` player-name--co-${coRole}` : '';
  const allyClass = isAlly ? ' ally-name' : '';
  return `<span class="player-name-icon">${roleIcon}</span>${separator}<span class="player-name-text${colorClass}${allyClass}">${escapeHtml(name)}</span>`;
}

function buildPlayerNameText(name, { coRole = null, fallbackRoleId = ROLES.VILLAGER.id } = {}) {
  const roleObj = (coRole ? ROLE_BY_ID[coRole] : null)
    || ROLE_BY_ID[fallbackRoleId]
    || ROLES.VILLAGER;
  const roleIcon = roleObj?.icon || ROLES.VILLAGER.icon;
  return `${roleIcon} ${name}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
