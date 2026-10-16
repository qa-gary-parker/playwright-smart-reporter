import { spawnSync, type ChildProcess } from 'child_process';

// start takes its first quoted argument as the window title, and Node passes '' to cmd as "".
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return [platform === 'darwin' ? 'open' : 'xdg-open', [url]];
}

// Stops a run started by serve and every process under it, such as the Playwright runner's workers.
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    if (result.status !== 0) child.kill('SIGTERM');
    return;
  }
  try {
    // The run is spawned detached, so its pid is also the id of the process group it shares with its children.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}
