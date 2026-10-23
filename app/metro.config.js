// @ts-check
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 공유 Zod 스키마(@berun/shared)를 빌드 없이 소스로 쓴다 ("source" export 조건, 관리자 웹과 같은 방식)
config.resolver.unstable_conditionNames = [
  'source',
  ...(config.resolver.unstable_conditionNames ?? ['require', 'default']),
];
// 공유 패키지 소스는 NodeNext 방식의 './x.js' import를 쓴다 → 같은 이름의 .ts로 찾는다
const sharedSrc = path.resolve(__dirname, '../packages/shared/src');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.originModulePath.startsWith(sharedSrc) && moduleName.endsWith('.js')) {
    const ts = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(ts)) return { type: 'sourceFile', filePath: ts };
  }
  return context.resolveRequest(context, moduleName, platform);
};

/**
 * 웹 개발 전용: 같은 출처의 /v1/* 요청을 로컬 API 서버(기본 localhost:3000)로 넘긴다.
 * 서버에 CORS를 열지 않고 Expo 웹(react-native-web)에서 로컬 서버에 연결하기 위한 것 (tech/01 5장).
 * 네이티브 Development Build는 EXPO_PUBLIC_API_BASE_URL로 서버에 직접 붙는다.
 */
const API_ORIGIN = new URL(process.env.BERUN_API_ORIGIN ?? 'http://localhost:3000');
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url || !req.url.startsWith('/v1/')) return middleware(req, res, next);
    const upstream = http.request(
      {
        hostname: API_ORIGIN.hostname,
        port: API_ORIGIN.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: API_ORIGIN.host },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'INTERNAL', message: `API server unreachable at ${API_ORIGIN.origin}` },
          requestId: 'dev-proxy',
        }),
      );
    });
    req.pipe(upstream);
  },
};

module.exports = config;
