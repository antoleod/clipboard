export async function clearApplicationCaches(userId) {
  const removedKeys = [];
  const prefixes = [
    `clipboard-vault-items-${userId}`,
    `clipboard-vault-settings-${userId}`,
    `clipboard-vault-local-items-${userId}`,
    `clipboard-vault-snippets-${userId}`,
    `clipboard-vault-ui-${userId}`
  ];

  Object.keys(localStorage).forEach((key) => {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key);
      removedKeys.push(key);
    }
  });

  if ('caches' in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((name) => caches.delete(name)));
  }

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  }

  return { removedKeys };
}

