// BBS（電子掲示板）UI レンダリング

// 役職IDから役職オブジェクトを高速に引ける静的マップ
const ROLE_BY_ID = Object.values(ROLES).reduce((map, role) => {
  map[role.id] = role;
  return map;
}, {});

class BBS {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.playerFilterId = null;
    this.isBookmarkFilterEnabled = false;
    this.bookmarkedPostIds = new Set();
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
      const roleObj = post.coRole ? ROLE_BY_ID[post.coRole] : null;
      const roleIcon = roleObj ? roleObj.icon : ROLES.VILLAGER.icon;
      const nameDisplay = `${roleIcon} ${this._escape(post.playerName)}`;
      el.innerHTML = `
        <div class="bbs-post__row">
          <label class="bbs-post__bookmark">
            <input type="checkbox" class="bbs-post__bookmark-checkbox" />
          </label>
          <span class="bbs-post__name">${nameDisplay}</span>
          <span class="bbs-post__body">${this._escape(post.content)}</span>
        </div>`;
    }

    el.dataset.postId = String(post.id);
    el.dataset.postType = post.type;
    el.dataset.playerId = post.playerId || '';
    this._bindBookmarkCheckbox(el, post);
    this._applyFilterToPostElement(el);
    this.container.appendChild(el);
    this._scrollToBottom();
  }

  // 全投稿を再レンダリング
  renderAll(posts) {
    if (!this.container) return;
    this.container.innerHTML = '';
    posts.forEach((post) => this.renderPost(post));
    this.applyFilters();
  }

  togglePlayerFilter(playerId) {
    this.playerFilterId = this.playerFilterId === playerId ? null : playerId;
    this.applyFilters();
    return this.playerFilterId;
  }

  toggleBookmarkFilter() {
    this.isBookmarkFilterEnabled = !this.isBookmarkFilterEnabled;
    this.applyFilters();
    return this.isBookmarkFilterEnabled;
  }

  applyFilters() {
    if (!this.container) return;
    this.container.querySelectorAll('.bbs-post').forEach((postEl) => {
      this._applyFilterToPostElement(postEl);
    });
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

  _bindBookmarkCheckbox(postElement, post) {
    if (post.type === 'system') return;
    const checkbox = postElement.querySelector('.bbs-post__bookmark-checkbox');
    if (!checkbox) return;
    checkbox.checked = this.bookmarkedPostIds.has(post.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) this.bookmarkedPostIds.add(post.id);
      else this.bookmarkedPostIds.delete(post.id);
      if (this.isBookmarkFilterEnabled) this.applyFilters();
    });
  }

  _applyFilterToPostElement(postElement) {
    const postType = postElement.dataset.postType || 'speech';
    const postPlayerId = postElement.dataset.playerId || '';
    const postId = Number(postElement.dataset.postId || '0');

    let visible = true;
    if (this.playerFilterId) {
      visible = visible && postType !== 'system' && postPlayerId === this.playerFilterId;
    }
    if (this.isBookmarkFilterEnabled) {
      visible = visible && postType !== 'system' && this.bookmarkedPostIds.has(postId);
    }
    postElement.style.display = visible ? '' : 'none';
  }
}

// プレイヤーリストのレンダリング
function renderPlayerList(players, options = {}) {
  const {
    containerId = 'player-list',
    onPlayerClick = null,
    activePlayerId = null,
    voteTargetId = null,
  } = options;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  players.forEach((player) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `player-card ${player.isAlive ? '' : 'player-card--dead'} ${activePlayerId === player.id ? 'player-card--active' : ''} ${voteTargetId === player.id ? 'player-card--vote-target' : ''}`;
    el.dataset.playerId = player.id;

    const badge = player.isHuman ? '<span class="badge badge--human">あなた</span>' : '';
    const deadMark = player.isAlive ? '' : '<span class="badge badge--dead">死亡</span>';
    const coRoleObj = player.coRole ? ROLE_BY_ID[player.coRole] : null;
    const rolePrefix = coRoleObj ? `${coRoleObj.icon} ` : '';

    el.innerHTML = `
      <span class="player-card__name">${rolePrefix}${escapeHtml(player.name)}</span>
      ${badge}${deadMark}`;
    if (typeof onPlayerClick === 'function') {
      el.addEventListener('click', () => onPlayerClick(player));
    }
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
