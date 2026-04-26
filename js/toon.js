// TOON (Token-Oriented Object Notation) ユーティリティ
// Spec v3.0: https://github.com/toon-format/spec
//
// 【Gemini / OpenAI API の TOON サポート状況 (2025年)】
// - Gemini API  : TOON 非対応。responseMimeType は 'application/json' / 'text/plain' のみ。
// - OpenAI API  : TOON 非対応。response_format は json_object / json_schema のみ。
// → TOON 出力はプロンプト指示で制御し、レスポンス解析は TOON → JSON フォールバックで行います。

// ─────────────────────────────────────────────────────────────────────────────
// エンコード（入力データをTOON形式に変換）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TOON の値を文字列にエスケープします。
 * ASCII カンマ・パイプ・改行・ダブルクォートを含む場合はクォートします。
 */
function toonEscapeValue(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // 数値・真偽値・null に見える文字列はクォート（型混乱を防ぐ）
  if (s === 'true' || s === 'false' || s === 'null' || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    return '"' + s + '"';
  }
  if (
    s.includes(',') || s.includes('|') || s.includes('"') ||
    s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)
  ) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
  }
  return s;
}

/**
 * bbsLog エントリ（公開チャット＋人狼チャット混合）を TOON リスト形式に変換します。
 * @param {Array} mixedPosts  [{post: bbsEntry, isWolf: boolean}]
 */
function formatMixedPostsAsToon(mixedPosts) {
  if (!mixedPosts || mixedPosts.length === 0) return 'chat[0]:';
  const items = mixedPosts.map(({ post, isWolf }) => {
    const name = post.playerName === '★システム' ? 'GM' : post.playerName;
    const content = post.content || '';
    const field = isWolf ? 'werewolfOnlySecretTalk' : 'talk';
    const parts = [`  - name: ${toonEscapeValue(name)}`];
    if (post.coRole) parts.push(`    coRole: ${toonEscapeValue(post.coRole)}`);
    parts.push(`    ${field}: ${toonEscapeValue(content)}`);
    return parts.join('\n');
  });
  return `chat[${mixedPosts.length}]:\n${items.join('\n')}`;
}

/**
 * bbsLog エントリ（公開チャットのみ）を TOON 表形式に変換します。
 * @param {Array} posts  bbsLog エントリの配列
 */
function formatPublicPostsAsToon(posts) {
  if (!posts || posts.length === 0) return 'chat[0]{name,talk}:';
  const rows = posts.map((post) => {
    const name = post.playerName === '★システム' ? 'GM' : post.playerName;
    return `  ${toonEscapeValue(name)},${toonEscapeValue(post.content || '')}`;
  });
  return `chat[${posts.length}]{name,talk}:\n${rows.join('\n')}`;
}

/**
 * 未反映投稿（_parseResponse 戻り値、{name,talk,coRole?} 形式）を TOON リスト形式に変換します。
 * @param {Array} posts  [{name, talk, coRole?}]
 */
function formatUnreflectedPostsAsToon(posts) {
  if (!posts || posts.length === 0) return '';
  const valid = posts.filter((p) => p.talk);
  if (valid.length === 0) return '';
  const items = valid.map((post) => {
    const parts = [`  - name: ${toonEscapeValue(post.name)}`];
    if (post.coRole) parts.push(`    coRole: ${toonEscapeValue(post.coRole)}`);
    parts.push(`    talk: ${toonEscapeValue(post.talk)}`);
    return parts.join('\n');
  });
  return `chat[${valid.length}]:\n${items.join('\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// デコード（LLM の TOON レスポンスを JavaScript オブジェクトに変換）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TOON テキストを JavaScript オブジェクトにデコードします。
 * コードブロック（```toon ... ```）内の TOON も自動抽出します。
 * パース失敗時は null を返します。
 */
function decodeToon(text) {
  if (!text || !text.trim()) return null;
  try {
    const codeMatch = text.match(/```(?:toon)?\s*([\s\S]*?)```/);
    const content = codeMatch ? codeMatch[1].trim() : text.trim();
    return _parseToonDocument(content);
  } catch (e) {
    return null;
  }
}

// ─── 内部パース関数 ────────────────────────────────────────────────────────

function _getIndentLevel(line) {
  const m = line.match(/^( *)/);
  return m ? m[1].length : 0;
}

/**
 * TOON 値文字列をプリミティブ型に変換します。
 */
function toonParseValue(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (str === '' || str === 'null') return null;
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
    return str.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return str;
}

/**
 * TOON のカンマ区切り行をパースします（クォート文字列を正しく処理）。
 */
function toonParseRow(rowText) {
  const values = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < rowText.length; i++) {
    const ch = rowText[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < rowText.length) {
        const next = rowText[i + 1];
        if (next === '"') { current += '"'; i++; }
        else if (next === 'n') { current += '\n'; i++; }
        else if (next === '\\') { current += '\\'; i++; }
        else current += ch;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        values.push(toonParseValue(current));
        current = '';
      } else {
        current += ch;
      }
    }
  }
  values.push(toonParseValue(current));
  return values;
}

function _parseToonDocument(text) {
  const lines = text.split('\n');
  const { value } = _parseToonObject(lines, 0, -1);
  return value;
}

/**
 * TOON オブジェクトをパースします。
 * @param {string[]} lines   全行
 * @param {number}   startLine  開始行インデックス
 * @param {number}   parentIndent  親のインデント（-1 はルート）
 */
function _parseToonObject(lines, startLine, parentIndent) {
  const result = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = _getIndentLevel(line);
    if (parentIndent >= 0 && indent <= parentIndent) break;

    // key([N])({fields}): [inline]
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)(\[(\d*)\])?(\{([^}]*)\})?:\s*(.*)?$/);
    if (!match) { i++; continue; }

    const key = match[1];
    const hasArraySyntax = match[2] !== undefined;
    const lenStr = match[3];
    const len = (lenStr !== undefined && lenStr !== '') ? parseInt(lenStr, 10) : null;
    const hasFields = !!(match[4] && match[5]);
    const fields = hasFields ? match[5].split(',').map((f) => f.trim()) : null;
    const inline = (match[6] || '').trim();

    if (hasArraySyntax) {
      if (fields) {
        // Tabular array: key[N]{f1,f2}:
        const rows = [];
        i++;
        while (i < lines.length) {
          const rowLine = lines[i];
          const rowTrimmed = rowLine.trim();
          if (!rowTrimmed || rowTrimmed.startsWith('#')) { i++; continue; }
          if (_getIndentLevel(rowLine) <= indent) break;
          if (rowTrimmed.startsWith('-')) break;
          const values = toonParseRow(rowTrimmed);
          const obj = {};
          fields.forEach((f, idx) => {
            const v = idx < values.length ? values[idx] : null;
            if (v !== null && v !== undefined) obj[f] = v;
          });
          rows.push(obj);
          i++;
        }
        result[key] = rows;
      } else if (inline) {
        // Inline primitive array: key[N]: v1,v2
        const values = toonParseRow(inline).filter((v) => v !== null && v !== '');
        result[key] = values;
        i++;
      } else {
        // Object list: key[N]:\n  - ...
        const items = [];
        i++;
        while (i < lines.length) {
          const itemLine = lines[i];
          const itemTrimmed = itemLine.trim();
          if (!itemTrimmed || itemTrimmed.startsWith('#')) { i++; continue; }
          const itemIndent = _getIndentLevel(itemLine);
          if (itemIndent <= indent) break;
          if (itemTrimmed.startsWith('- ') || itemTrimmed === '-') {
            const { obj, nextLine } = _parseListItem(lines, i);
            items.push(obj);
            i = nextLine;
          } else {
            i++;
          }
        }
        result[key] = items;
      }
    } else {
      // Simple key: value
      if (inline) {
        result[key] = toonParseValue(inline);
        i++;
      } else {
        // Nested object
        const { value: nested, nextLine } = _parseToonObject(lines, i + 1, indent);
        result[key] = nested;
        i = nextLine;
      }
    }
  }

  return { value: result, nextLine: i };
}

/**
 * "  - key: value\n    key2: value2 ..." 形式のリストアイテムをパースします。
 */
function _parseListItem(lines, startLine) {
  const line = lines[startLine];
  const indent = _getIndentLevel(line);
  const trimmed = line.trim().slice(2).trim(); // Remove "- "

  const obj = {};

  // First key: value on the "- key: value" line
  const kvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)(\[(\d*)\])?:\s*(.*)?$/);
  if (kvMatch) {
    const k = kvMatch[1];
    const hasArr = kvMatch[2] !== undefined;
    const inlineVal = (kvMatch[4] || '').trim();
    if (hasArr && inlineVal) {
      obj[k] = toonParseRow(inlineVal).filter((v) => v !== null && v !== '');
    } else if (inlineVal) {
      obj[k] = toonParseValue(inlineVal);
    }
  } else {
    // Scalar list item
    return { obj: toonParseValue(trimmed), nextLine: startLine + 1 };
  }

  let i = startLine + 1;
  const innerIndent = indent + 2;

  while (i < lines.length) {
    const contLine = lines[i];
    const contTrimmed = contLine.trim();
    if (!contTrimmed || contTrimmed.startsWith('#')) { i++; continue; }
    const contIndent = _getIndentLevel(contLine);
    if (contIndent < innerIndent) break;
    if (contTrimmed.startsWith('- ')) break;

    const contMatch = contTrimmed.match(/^([A-Za-z_][A-Za-z0-9_.]*)(\[(\d*)\])?:\s*(.*)?$/);
    if (contMatch) {
      const k = contMatch[1];
      const hasArr = contMatch[2] !== undefined;
      const val = (contMatch[4] || '').trim();
      if (hasArr && val) {
        obj[k] = toonParseRow(val).filter((v) => v !== null && v !== '');
      } else {
        obj[k] = toonParseValue(val);
      }
    }
    i++;
  }

  return { obj, nextLine: i };
}
