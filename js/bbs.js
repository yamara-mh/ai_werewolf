// BBS（電子掲示板）UI レンダリング

const SCROLL_POSITION_TOLERANCE = 4;
// 下端に居ると判定するための閾値（px）
// 投稿追加直後の行高変動を吸収するため、24px以内を「最下部付近」とみなす
const SCROLL_NEAR_BOTTOM_THRESHOLD = 24;

class BBS {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.playerFilterId = null;
    this.isBookmarkFilterEnabled = false;
    this.bookmarkedPostIds = new Set();
    this.bookmarkFilterScrollTop = null;
    this.knownAllyIds = new Set();
    this.canViewWhisper = false;
    this.suppressAutoScroll = false;
    this.scrollBottomBtn = document.getElementById('bbs-scroll-bottom-btn');
    this.dayScrollUpBtn = document.getElementById('bbs-day-scroll-up-btn');
    this.dayScrollDownBtn = document.getElementById('bbs-day-scroll-down-btn');

    if (this.container) {
      this.container.addEventListener('scroll', () => this._updateScrollBottomButton());
    }
    if (this.scrollBottomBtn) {
      this.scrollBottomBtn.addEventListener('click', () => {
        this.scrollToBottom();
      });
    }
    if (this.dayScrollUpBtn) {
      this.dayScrollUpBtn.addEventListener('click', () => this.scrollByDay(-1));
    }
    if (this.dayScrollDownBtn) {
      this.dayScrollDownBtn.addEventListener('click', () => this.scrollByDay(1));
    }
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
      const isAlly = this.knownAllyIds.has(post.playerId);
      const nameHtml = buildPlayerNameHtml(post.playerName, {
        coRole: post.coRole,
        isAlly,
        fallbackRoleId: ROLES.VILLAGER.id,
        breakLine: true,
      });
      const portraitSrc = `personality/portrait/${this._escape(post.playerName)}.png`;
      const isWolfChat = post.type === 'wolf_chat' || post.type === 'whisper'; // 'whisper' は後方互換
      const wolfChatClass = isWolfChat ? ' bbs-post__row--wolf-chat' : '';
      const wolfChatPrefix = isWolfChat ? '<span class="bbs-post__whisper-prefix">🐺狼チャット</span> ' : '';
      el.innerHTML = `
        <div class="bbs-post__row${wolfChatClass}">
          <label class="bbs-post__bookmark">
            <input type="checkbox" class="bbs-post__bookmark-checkbox" />
          </label>
          <img src="${portraitSrc}" onerror="this.src='personality/portrait/default.png'" class="player-portrait player-portrait--post" alt="" />
          <span class="bbs-post__name">${nameHtml}</span>
          <span class="bbs-post__body">${wolfChatPrefix}${this._escape(post.content)}</span>
        </div>`;
    }

    el.dataset.postId = String(post.id);
    el.dataset.postType = post.type;
    el.dataset.playerId = post.playerId || '';
    this._bindBookmarkCheckbox(el, post);
    this._applyFilterToPostElement(el);
    const shouldStickToBottom = this._isNearBottom();
    this.container.appendChild(el);
    if (this.suppressAutoScroll || shouldStickToBottom) this._scrollToBottom();
    this._updateScrollBottomButton();
  }

  // 全投稿を再レンダリング（フェーズヘッダーも自動挿入）
  renderAll(posts) {
    if (!this.container) return;
    this.suppressAutoScroll = true;
    this.container.innerHTML = '';
    let lastDay = null;
    let lastPhase = null;
    posts.forEach((post) => {
      if (post.day !== lastDay || post.phase !== lastPhase) {
        this.renderPhaseHeader(post.day, post.phase);
        lastDay = post.day;
        lastPhase = post.phase;
      }
      this.renderPost(post);
    });
    this.suppressAutoScroll = false;
    this._scrollToBottom();
    this.applyFilters();
    this._updateScrollBottomButton();
  }

  togglePlayerFilter(playerId) {
    this.playerFilterId = this.playerFilterId === playerId ? null : playerId;
    this.applyFilters();
    return this.playerFilterId;
  }

  toggleBookmarkFilter() {
    if (!this.container) return false;
    if (!this.isBookmarkFilterEnabled) {
      this.bookmarkFilterScrollTop = this.container.scrollTop;
    }
    this.isBookmarkFilterEnabled = !this.isBookmarkFilterEnabled;
    this.applyFilters();
    if (!this.isBookmarkFilterEnabled && this.bookmarkFilterScrollTop !== null) {
      const restoreTop = this.bookmarkFilterScrollTop;
      requestAnimationFrame(() => {
        this.container.scrollTop = Math.max(0, restoreTop);
      });
      this.bookmarkFilterScrollTop = null;
    }
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
    el.dataset.day = String(day);
    el.textContent = `── ${day}日目 ${this._phaseLabel(phase)} ──`;
    const shouldStickToBottom = this._isNearBottom();
    this.container.appendChild(el);
    if (this.suppressAutoScroll || shouldStickToBottom) this._scrollToBottom();
    this._updateScrollBottomButton();
  }

  // "タイピング中..." 表示
  showTypingIndicator(playerName) {
    this.removeTypingIndicator();
    const el = document.createElement('div');
    el.className = 'bbs-typing';
    el.id = 'bbs-typing';
    el.textContent = `${playerName} が入力中...`;
    const shouldStickToBottom = this._isNearBottom();
    this.container.appendChild(el);
    if (shouldStickToBottom) this._scrollToBottom();
    this._updateScrollBottomButton();
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

  scrollToBottom() {
    this._scrollToBottom();
    this._updateScrollBottomButton();
  }

  scrollByDay(delta) {
    if (!this.container || !delta) return;
    const headers = Array.from(this.container.querySelectorAll('.bbs-phase-header[data-day]'));
    if (headers.length === 0) return;
    const currentTop = this.container.scrollTop;
    const currentTopEdge = Math.max(0, currentTop - SCROLL_POSITION_TOLERANCE);
    const currentHeader = headers
      .filter((h) => h.offsetTop <= currentTopEdge)
      .pop() || headers[0];
    const currentDay = Number(currentHeader.dataset.day || '1');
    const targetDay = Math.max(1, currentDay + delta);
    const targetHeader = headers.find((h) => Number(h.dataset.day || '0') === targetDay);
    if (!targetHeader) {
      if (delta > 0) {
        this._scrollToBottom();
        this._updateScrollBottomButton();
      }
      return;
    }
    this.container.scrollTop = Math.max(0, targetHeader.offsetTop);
    this._updateScrollBottomButton();
  }

  _bindBookmarkCheckbox(postElement, post) {
    if (post.type === 'system') return;
    const checkbox = postElement.querySelector('.bbs-post__bookmark-checkbox');
    const row = postElement.querySelector('.bbs-post__row');
    if (!checkbox) return;
    const updateRowState = () => {
      if (!row) return;
      row.classList.toggle('bbs-post__row--bookmarked', checkbox.checked);
    };
    checkbox.checked = this.bookmarkedPostIds.has(post.id);
    updateRowState();
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) this.bookmarkedPostIds.add(post.id);
      else this.bookmarkedPostIds.delete(post.id);
      updateRowState();
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
    if (postType === 'whisper' || postType === 'wolf_chat') {
      if (!this.canViewWhisper) visible = false;
    }
    postElement.style.display = visible ? '' : 'none';
  }

  _isNearBottom() {
    if (!this.container) return true;
    return this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight <= SCROLL_NEAR_BOTTOM_THRESHOLD;
  }

  _updateScrollBottomButton() {
    if (!this.container || !this.scrollBottomBtn) return;
    const isNearBottom = this._isNearBottom();
    this.scrollBottomBtn.classList.toggle('hidden', isNearBottom);
  }

  setKnownAllies({ allyIds = [], canViewWhisper = false } = {}) {
    this.knownAllyIds = new Set(allyIds);
    this.canViewWhisper = !!canViewWhisper;
  }
}
