'use strict';

module.exports = [
  ...require('gts'),
  {
    ignores: ['build/', '*.test.ts', 'vitest.config.ts'],
  },
];
