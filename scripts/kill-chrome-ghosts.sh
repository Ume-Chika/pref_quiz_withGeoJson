#!/usr/bin/env bash
# 開発時に残留したヘッドレスChromeの孤児プロセスおよび一時プロファイルを一括駆除するスクリプト

set -euo pipefail

echo "ヘッドレスChromeの残留プロセスを検索中..."

PIDS=$(ps aux | grep -E "Google Chrome.*(headless|pref-quiz-chrome)" | grep -v grep | awk '{print $2}' || true)

if [ -n "$PIDS" ]; then
  echo "検出されたプロセス: $PIDS"
  for pid in $PIDS; do
    kill -9 "$pid" 2>/dev/null || true
  done
  echo "ヘッドレスChromeプロセスを一括終了しました。"
else
  echo "残留しているヘッドレスChromeプロセスはありません。"
fi

echo "一時プロファイル残骸を削除中..."
rm -rf /tmp/pref-quiz-chrome-* 2>/dev/null || true
rm -rf "${TMPDIR:-/tmp}"/pref-quiz-chrome-* 2>/dev/null || true
rm -rf "$HOME/Library/Application Support/Google/Chrome-headless/scoped_dir*" 2>/dev/null || true

echo "クリーンアップが完了しました。"
