import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * 관리자 API(/api/admin/v1)를 같은 출처로 프록시한다 — 세션 쿠키(SameSite=Strict, path /api/admin)와
 * CSRF 헤더가 그대로 동작한다. 운영에서도 admin 도메인 앞단(ALB)이 같은 경로를 API로 보낸다 (tech/03).
 */
const API_ORIGIN = process.env.ADMIN_API_ORIGIN ?? 'http://localhost:3000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // pnpm 워크스페이스 루트 기준으로 추적 (lockfile 경고 방지)
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  // ESLint는 루트 `pnpm lint`가 맡는다
  eslint: { ignoreDuringBuilds: true },
  // 공유 Zod 스키마를 빌드 없이 소스로 쓴다 (packages/shared의 "source" export 조건)
  transpilePackages: ['@berun/shared'],
  webpack: (cfg: {
    resolve: { conditionNames?: string[]; extensionAlias?: Record<string, string[]> };
  }) => {
    // 공유 패키지 소스는 NodeNext 방식의 './x.js' import를 쓴다 → .ts로 찾는다
    cfg.resolve.extensionAlias = { ...cfg.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    cfg.resolve.conditionNames = [
      'source',
      ...(cfg.resolve.conditionNames ?? ['import', 'module', 'require', 'default']),
    ];
    return cfg;
  },
  async rewrites() {
    return [{ source: '/api/admin/:path*', destination: `${API_ORIGIN}/api/admin/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
