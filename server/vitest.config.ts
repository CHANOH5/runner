import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // 통합 테스트는 같은 테스트 DB를 쓰므로 파일 단위로 순차 실행한다
    fileParallelism: false,
  },
});
