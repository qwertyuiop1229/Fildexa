import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)qwertyuiop1229\/fildexa(?:\.git)?\/?$/i;

function run(command, args, { cwd = root, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args[0] + ' が正常に完了しませんでした。');
  }
  return result.stdout?.trim();
}

const git = (...args) => run('git', args, { capture: true });

let staging;
let pushed = false;
try {
  if (git('branch', '--show-current') !== 'main') {
    throw new Error('main ブランチに切り替えてから公開してください。');
  }
  if (git('status', '--porcelain', '--untracked-files=all')) {
    throw new Error('公開する変更をコミットしてから実行してください。');
  }
  const pushTargets = git('remote', 'get-url', '--push', '--all', 'origin').split(/\r?\n/);
  if (pushTargets.length !== 1 || !repository.test(pushTargets[0])) {
    throw new Error('origin の push 先を qwertyuiop1229/Fildexa に設定してください。');
  }

  const commit = git('rev-parse', 'HEAD');
  staging = mkdtempSync(join(tmpdir(), 'fildexa-release-'));
  const archive = join(staging, 'source.tar');
  run('git', ['archive', '--format=tar', '--output=' + archive, commit]);
  run('tar', ['-xf', archive, '-C', staging]);
  rmSync(archive);
  run(process.execPath, ['--test'], { cwd: staging });
  run('git', ['push', 'origin', commit + ':refs/heads/main']);
  pushed = true;
  const published = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/s+/)[0];
  if (published !== commit) throw new Error('GitHub の main が更新されました。最新のコミットを確認してください。');
  run(process.execPath, [
    process.env.npm_execpath, 'exec', '--yes', '--package=firebase-tools@15.37.0',
    '--', 'firebase', 'deploy', '--only', 'hosting', '--project', 'fildexa', '--non-interactive',
  ], { cwd: staging });
  console.log('公開完了 ' + commit.slice(0, 12));
} catch (error) {
  console.error(error.message);
  if (pushed) console.error('GitHub への反映は完了済みです。原因を解消して npm run deploy を再実行できます。');
  process.exitCode = 1;
} finally {
  if (staging) rmSync(staging, { recursive: true, force: true });
}
