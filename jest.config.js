/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  injectGlobals: true,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  // Coverage thresholds set as a floor — actual coverage is well above these.
  // Branches/statements are intentionally a few points below current (94.6%/98.6%)
  // because the gaps are almost entirely defensive try/catch and optional-chain
  // fallback branches in the Sentry-compat shims. Ratchet these up as we add
  // more behavioral tests.
  coverageThreshold: {
    global: {
      branches: 93,
      functions: 100,
      lines: 99,
      statements: 98,
    },
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/stores/console.ts', // Display-only provider, basic tests sufficient
  ],
  verbose: true,
};
