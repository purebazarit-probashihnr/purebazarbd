import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const srcRoot = join(frontendRoot, 'src');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function normalizeLineEndings(contents) {
  return contents.replace(/\r\n?/g, '\n');
}

describe('frontend shared billing modules', () => {
  it('keeps the frontend copies in sync with the backend modules', () => {
    const modules = [
      ['backend/services/billEngine.js', 'frontend/src/shared/billEngine.cjs'],
      ['backend/utils/piecePricing.js', 'frontend/src/shared/piecePricing.cjs'],
    ];

    for (const [backendPath, frontendPath] of modules) {
      const backend = readFileSync(join(repositoryRoot, backendPath), 'utf8');
      const frontend = readFileSync(join(repositoryRoot, frontendPath), 'utf8');
      assert.equal(
        normalizeLineEndings(frontend),
        normalizeLineEndings(backend),
        `${frontendPath} differs from ${backendPath}; re-copy the backend file to the frontend copy.`,
      );
    }
  });

  it('does not import backend paths from frontend source', () => {
    const importPattern = /(?:\brequire\s*\(\s*|\bfrom\s*|\bimport\s*\()\s*['"]([^'"]*\/backend\/[^'"]*)['"]/g;
    const violations = [];

    for (const path of sourceFiles(srcRoot)) {
      const contents = readFileSync(path, 'utf8');
      for (const match of contents.matchAll(importPattern)) {
        violations.push(`${relative(frontendRoot, path)} imports "${match[1]}"`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Frontend source must not import paths containing '/backend/':\n${violations.join('\n')}`,
    );
  });
});
