import { db } from './index.mjs';

// 追加式玩家事件：新玩法可以先埋事件，再从事件重算统计，不需要改表。
export function recordPlayerEvent(accountId, eventType, payload = {}) {
  db.prepare(
    `INSERT INTO player_events (account_id, event_type, payload, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(accountId, eventType, JSON.stringify(payload || {}), Date.now());
}
