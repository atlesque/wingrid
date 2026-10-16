const origin = 'https://wingrid.atlesque.dev';
for (const path of ['/', '/api/config']) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (path === '/api/config' && (await response.json()).gameId !== 'wingrid') {
    throw new Error('Unexpected production configuration');
  }
}
console.log('Production home page and API configuration passed.');
