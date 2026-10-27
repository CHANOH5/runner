/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  moduleNameMapper: {
    // 공유 Zod 스키마를 빌드 없이 소스로 (metro.config.js와 같은 방식)
    '^@berun/shared$': '<rootDir>/../packages/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
