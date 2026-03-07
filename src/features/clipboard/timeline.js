function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function getTimelineBucket(isoDate) {
  const now = new Date();
  const date = new Date(isoDate);

  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  if (date >= todayStart) return 'Today';
  if (date >= yesterdayStart) return 'Yesterday';
  if (date >= weekStart) return 'This week';
  return 'Older';
}

export function groupByTimeline(items) {
  const sections = { Today: [], Yesterday: [], 'This week': [], Older: [] };
  for (const item of items) {
    const bucket = getTimelineBucket(item.createdAt);
    sections[bucket].push(item);
  }
  return sections;
}

