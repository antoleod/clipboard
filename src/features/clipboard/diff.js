export function compareTextEntries(left = '', right = '') {
  const a = String(left).split('\n');
  const b = String(right).split('\n');
  const max = Math.max(a.length, b.length);
  const rows = [];

  for (let i = 0; i < max; i += 1) {
    const l = a[i] ?? '';
    const r = b[i] ?? '';
    let type = 'same';
    if (l !== r) type = l && r ? 'changed' : l ? 'removed' : 'added';
    rows.push({ line: i + 1, left: l, right: r, type });
  }

  return rows;
}

