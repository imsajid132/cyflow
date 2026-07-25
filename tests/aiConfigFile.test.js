// The file-based fallback for the AI studio's settings.
//
// This exists because the production host's control panel will not store the
// studio's two settings: adding them singly, renaming them, and importing a
// complete .env all ended with the saved set coming back without them. The app
// therefore also reads a small settings file. These tests pin the contract that
// makes that safe: the environment always wins, a missing file is harmless, and
// the file is found in the persistent directory that survives a deployment.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readAiConfigFile, candidatePaths } from '../src/services/aiStudio/aiConfigFile.js';
import { isClaudeConfigured, readApiKey } from '../src/services/aiStudio/claudeClient.js';
import { isAiStudioMode } from '../src/services/aiStudio/aiStudioEngine.js';

/** Run `fn` with a settings file in place and the env cleared, then restore. */
function withConfigFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cyflow-aiconf-'));
  const file = join(dir, 'ai.env');
  writeFileSync(file, contents);
  const saved = {
    explicit: process.env.CYFLOW_AI_ENV_FILE,
    key: process.env.AI_API_KEY,
    altKey: process.env.CYFLOW_STUDIO_KEY,
    mode: process.env.AI_STUDIO_MODE,
    altMode: process.env.CYFLOW_STUDIO_MODE,
  };
  process.env.CYFLOW_AI_ENV_FILE = file;
  delete process.env.AI_API_KEY;
  delete process.env.CYFLOW_STUDIO_KEY;
  delete process.env.AI_STUDIO_MODE;
  delete process.env.CYFLOW_STUDIO_MODE;
  readAiConfigFile({ refresh: true });
  try {
    return fn();
  } finally {
    for (const [name, value] of [
      ['CYFLOW_AI_ENV_FILE', saved.explicit], ['AI_API_KEY', saved.key],
      ['CYFLOW_STUDIO_KEY', saved.altKey], ['AI_STUDIO_MODE', saved.mode],
      ['CYFLOW_STUDIO_MODE', saved.altMode],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    readAiConfigFile({ refresh: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a settings file configures the studio when the environment cannot', () => {
  withConfigFile('AI_API_KEY=file-provided-key\nAI_STUDIO_MODE=on\n', () => {
    assert.equal(isClaudeConfigured(), true, 'the key is found in the file');
    assert.equal(readApiKey(), 'file-provided-key');
    assert.equal(isAiStudioMode(), true, 'the mode flag is found in the file');
  });
});

test('the file tolerates comments, blank lines, quotes and stray spacing', () => {
  withConfigFile('\n# the studio key\n  AI_API_KEY = "quoted-key"  \n\nAI_STUDIO_MODE=\'on\'\n', () => {
    assert.equal(readApiKey(), 'quoted-key');
    assert.equal(isAiStudioMode(), true);
  });
});

test('the environment always wins over the file', () => {
  withConfigFile('AI_API_KEY=file-key\nAI_STUDIO_MODE=on\n', () => {
    process.env.AI_API_KEY = 'environment-key';
    assert.equal(readApiKey(), 'environment-key', 'env is not overridden by the file');
    delete process.env.AI_API_KEY;
  });
});

test('a missing or empty file is harmless, not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyflow-aiconf-'));
  const saved = process.env.CYFLOW_AI_ENV_FILE;
  try {
    process.env.CYFLOW_AI_ENV_FILE = join(dir, 'does-not-exist.env');
    assert.deepEqual(readAiConfigFile({ refresh: true }), {});
  } finally {
    if (saved === undefined) delete process.env.CYFLOW_AI_ENV_FILE;
    else process.env.CYFLOW_AI_ENV_FILE = saved;
    readAiConfigFile({ refresh: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * The deployment-survival property: the settings file is looked for beside the
 * media directory, which lives outside the deployed tree on the host. A file in
 * the app folder would be wiped by the next deployment.
 */
test('the media directory is searched, so the file survives a deployment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyflow-private-'));
  const saved = { media: process.env.MEDIA_STORAGE_PATH, explicit: process.env.CYFLOW_AI_ENV_FILE };
  try {
    delete process.env.CYFLOW_AI_ENV_FILE;
    mkdirSync(join(dir, 'media'), { recursive: true });
    process.env.MEDIA_STORAGE_PATH = join(dir, 'media');
    writeFileSync(join(dir, 'ai.env'), 'AI_API_KEY=beside-the-media-dir\n');

    assert.ok(candidatePaths().includes(join(dir, 'ai.env')), 'the private directory is a candidate');
    assert.equal(readAiConfigFile({ refresh: true }).AI_API_KEY, 'beside-the-media-dir');
  } finally {
    if (saved.media === undefined) delete process.env.MEDIA_STORAGE_PATH;
    else process.env.MEDIA_STORAGE_PATH = saved.media;
    if (saved.explicit !== undefined) process.env.CYFLOW_AI_ENV_FILE = saved.explicit;
    readAiConfigFile({ refresh: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
