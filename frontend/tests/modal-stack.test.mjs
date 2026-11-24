import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createModalStack } = require('../src/components/ui/modal-stack.cjs');

describe('modal stack', () => {
  it('layers each modal above the previous one and restores the lower top on close', () => {
    const stack = createModalStack();

    assert.equal(stack.register('details'), 1000);
    assert.equal(stack.register('receipt'), 1002);
    assert.equal(stack.isTop('receipt'), true);
    assert.equal(stack.isTop('details'), false);

    stack.unregister('receipt');
    assert.equal(stack.isTop('details'), true);

    assert.equal(stack.register('receipt'), 1004);
    stack.unregister('details');
    assert.equal(stack.isTop('receipt'), true);
    assert.equal(stack.register('confirmation'), 1006);
    assert.equal(stack.isTop('confirmation'), true);
    stack.unregister('confirmation');
    assert.equal(stack.isTop('receipt'), true);
    stack.unregister('receipt');
    assert.equal(stack.size, 0);
  });
});
