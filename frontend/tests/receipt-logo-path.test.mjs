import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const pathModule = readFileSync(resolve(publicDir, 'receipt-logo-path.js'), 'utf8');

describe('receipt logo path', () => {
  it('points to an existing public asset', () => {
    const scope = {};
    runInNewContext(pathModule, { self: scope, window: scope });

    const logoPath = scope.PUREBAZAR_RECEIPT_LOGO_PATH;
    assert.equal(typeof logoPath, 'string');
    assert.ok(existsSync(resolve(publicDir, logoPath.slice(1))), `${logoPath} is missing from frontend/public`);
  });
});
