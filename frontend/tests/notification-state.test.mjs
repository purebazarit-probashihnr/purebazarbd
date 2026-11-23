import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { normalizeNotifications } = createRequire(import.meta.url)('../src/services/notification-state.cjs');

test('duplicate notification copies render once and keep the newest unread state', () => {
  const response = {
    total: 2,
    groups: [{
      key: 'low-stock',
      count: 2,
      items: [
        { id: 'same-alert', title: 'Older copy', createdAt: '2026-11-22T10:00:00Z', isRead: false },
        { id: 'same-alert', title: 'Newest copy', createdAt: '2026-11-23T10:00:00Z', isRead: true },
      ],
    }],
  };

  const firstPoll = normalizeNotifications(response);
  const secondPoll = normalizeNotifications(response);

  assert.deepEqual(firstPoll, secondPoll);
  assert.equal(firstPoll.total, 1);
  assert.equal(firstPoll.groups[0].count, 1);
  assert.equal(firstPoll.groups[0].items.slice(0, 3).length, 1);
  assert.deepEqual(firstPoll.groups[0].items[0], {
    id: 'same-alert',
    title: 'Newest copy',
    createdAt: '2026-11-23T10:00:00Z',
    isRead: false,
  });
});
