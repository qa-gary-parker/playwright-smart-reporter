const root = document.documentElement;

export function currentTheme() {
  const params = new URLSearchParams(location.search);
  return { mode: params.get('mode') ?? 'system', accent: params.get('accent') ?? 'default' };
}

export function applyTheme(mode: string, accent: string) {
  if (mode === 'system') delete root.dataset.mode;
  else root.dataset.mode = mode;
  if (accent === 'default') delete root.dataset.accent;
  else root.dataset.accent = accent;
  const url = new URL(location.href);
  url.searchParams.set('mode', mode);
  url.searchParams.set('accent', accent);
  history.replaceState(null, '', url);
}

export function screenHref(screen: string, extra: Record<string, string> = {}) {
  const url = new URL(location.href);
  url.searchParams.set('screen', screen);
  url.searchParams.delete('test');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.search;
}
