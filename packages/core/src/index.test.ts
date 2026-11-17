import { describe, expect, it } from 'vitest';

import * as core from './index.js';

// Proves the pipeline end to end: TypeScript resolves the package entry and
// Vitest runs. Replace with real tests (named after FR IDs) when C2 lands.
describe('@simbridge/core', () => {
  it('loads the package entry point', () => {
    expect(core).toBeDefined();
  });
});
