function timestamp(item) {
  const parsed = Date.parse(item.createdAt || '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function mergeCopies(current, incoming) {
  const newest = timestamp(incoming) > timestamp(current) ? incoming : current;
  const other = newest === incoming ? current : incoming;
  const merged = { ...other, ...newest };

  if ([current, incoming].some((item) => item.unread === true)) merged.unread = true;
  if ([current, incoming].some((item) => item.isUnread === true)) merged.isUnread = true;
  if ([current, incoming].some((item) => item.isRead === false)) merged.isRead = false;
  if ([current, incoming].some((item) => item.readAt === null)) merged.readAt = null;

  return merged;
}

function normalizeNotifications(notifications) {
  const sourceGroups = Array.isArray(notifications && notifications.groups) ? notifications.groups : [];
  const groups = sourceGroups.map((group) => ({
    ...group,
    items: [],
  }));
  const counts = sourceGroups.map((group) => (
    Number.isFinite(Number(group.count)) ? Number(group.count) : (Array.isArray(group.items) ? group.items.length : 0)
  ));
  const owners = new Map();

  sourceGroups.forEach((group, groupIndex) => {
    const items = Array.isArray(group.items) ? group.items : [];
    items.forEach((item) => {
      if (item.id === undefined || item.id === null) {
        groups[groupIndex].items.push(item);
        return;
      }

      const id = String(item.id);
      const owner = owners.get(id);
      if (!owner) {
        const copy = { ...item };
        groups[groupIndex].items.push(copy);
        owners.set(id, { groupIndex, item: copy });
        return;
      }

      const latest = mergeCopies(owner.item, item);
      const incomingIsNewer = timestamp(item) > timestamp(owner.item);
      const countIndex = incomingIsNewer ? owner.groupIndex : groupIndex;

      if (incomingIsNewer && owner.groupIndex !== groupIndex) {
        const previousItems = groups[owner.groupIndex].items;
        previousItems.splice(previousItems.indexOf(owner.item), 1);
        groups[groupIndex].items.push(latest);
        owners.set(id, { groupIndex, item: latest });
      } else {
        const targetGroupIndex = owner.groupIndex;
        const targetItems = groups[targetGroupIndex].items;
        const itemIndex = targetItems.indexOf(owner.item);
        targetItems[itemIndex] = latest;
        owners.set(id, { groupIndex: targetGroupIndex, item: latest });
      }

      counts[countIndex] = Math.max(0, counts[countIndex] - 1);
    });
  });

  groups.forEach((group, index) => {
    group.count = Math.max(group.items.length, counts[index]);
  });

  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
  };
}

module.exports = { normalizeNotifications };
