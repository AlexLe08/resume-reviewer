import { execSync } from 'node:child_process';

/** Records which version of the prompt and code produced these numbers. */
export function gitInfo(): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { commit: run('git rev-parse --short HEAD'), dirty: run('git status --porcelain').length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}
