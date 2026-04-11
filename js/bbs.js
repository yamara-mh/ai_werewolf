// BBS（電子掲示板）UI レンダリング

class BBS {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  // 投稿を一件レンダリング
  renderPost(post) {
    if (!this.container) return;

    const el = document.createElement('div');
    el.className = `bbs-post bbs-post--${post.type}`;
    el.id = `post-${post.id}`;

    if (post.type === 'system') {
      el.innerHTML = `
        <div class="bbs-post__system">
          <span class="bbs-post__icon">📢</span>
          <span class="bbs-post__content">${this._escape(post.content)}</span>
        </div>`;
    } else {
      const roleObj = post.coRole
        ? Object.values(ROLES).find((r) => r.id === post.coRole)
        : null;
      const roleSuffix = roleObj ? ` ${roleObj.icon}` : '';
      const nameDisplay = `${this._escape(post.playerName)}${roleSuffix}`;
      el.innerHTML = `
        <div class="bbs-post__row">
          <span class="bbs-post__name">${nameDisplay}</span>
          <span class="bbs-post__body">${this._escape(post.content)}</span>
        </div>`;
    }

    this.container.appendChild(el);
    this._scrollToBottom();
  }

  // 全投稿を再レンダリング
  renderAll(posts) {
    if (!this.container) return;
    this.container.innerHTML = '';
    posts.forEach((post) => this.renderPost(post));
  }

  // フェーズヘッダーを挿入
  renderPhaseHeader(day, phase) {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'bbs-phase-header';
    el.textContent = `── ${day}日目 ${this._phaseLabel(phase)} ──`;
    this.container.appendChild(el);
    this._scrollToBottom();
  }

  // "タイピング中..." 表示
  showTypingIndicator(playerName) {
    this.removeTypingIndicator();
    const el = document.createElement('div');
    el.className = 'bbs-typing';
    el.id = 'bbs-typing';
    el.textContent = `${playerName} が入力中...`;
    this.container.appendChild(el);
    this._scrollToBottom();
  }

  removeTypingIndicator() {
    const el = document.getElementById('bbs-typing');
    if (el) el.remove();
  }

  _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  _phaseLabel(phase) {
    const labels = {
      [GAME_PHASES.MORNING]: '🌅朝',
      [GAME_PHASES.DAY]: '☀️昼',
      [GAME_PHASES.VOTE]: '🗳️投票',
      [GAME_PHASES.EXECUTION]: '⚖️処刑',
      [GAME_PHASES.NIGHT]: '🌙夜',
      [GAME_PHASES.END]: '🏁終了',
    };
    return labels[phase] || '';
  }

  _scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
}

// プレイヤーリストのレンダリング
function renderPlayerList(players, containerId = 'player-list') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  players.forEach((player) => {
    const el = document.createElement('div');
    el.className = `player-card ${player.isAlive ? '' : 'player-card--dead'}`;
    el.dataset.playerId = player.id;

    const badge = player.isHuman ? '<span class="badge badge--human">あなた</span>' : '';
    const deadMark = player.isAlive ? '' : '<span class="badge badge--dead">死亡</span>';

    const coRoleObj = player.coRole
      ? Object.values(ROLES).find((r) => r.id === player.coRole)
      : null;
    const coRoleBadge = coRoleObj
      ? `<span class="badge badge--co">${coRoleObj.icon} ${coRoleObj.name}</span>`
      : '';

    el.innerHTML = `
      <span class="player-card__name">${escapeHtml(player.name)}</span>
      ${coRoleBadge}${badge}${deadMark}`;
    container.appendChild(el);
  });
}

// 投票UI のレンダリング
function renderVotePanel(alivePlayers, excludeId, containerId = 'vote-panel') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<p class="vote-panel__label">処刑する人を選んでください：</p>';

  alivePlayers
    .filter((p) => p.id !== excludeId)
    .forEach((player) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--vote';
      btn.dataset.targetId = player.id;
      btn.textContent = player.name;
      container.appendChild(btn);
    });
}

// 夜アクションUIのレンダリング
function renderNightPanel(role, alivePlayers, excludeId, containerId = 'night-panel') {
  const container = document.getElementById(containerId);
  if (!container) return;

  let label = '';
  if (isWerewolfRole(role)) label = '🐺 今夜、誰を襲撃しますか？';
  else if (role?.id === ROLES.SEER.id) label = '🔮 今夜、誰を占いますか？';
  else if (role?.id === ROLES.HUNTER.id) label = '🛡️ 今夜、誰を護衛しますか？';
  else {
    container.innerHTML = '<p class="night-panel__label">あなたの夜のアクションはありません。AIが行動するのを待っています…</p>';
    return;
  }

  container.innerHTML = `<p class="night-panel__label">${label}</p>`;

  alivePlayers
    .filter((p) => p.id !== excludeId)
    .forEach((player) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--night';
      btn.dataset.targetId = player.id;
      btn.textContent = player.name;
      container.appendChild(btn);
    });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
