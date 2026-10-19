# Safe Drive
안전 경로 내비게이션 (초보 운전자용). 정적 웹 → Capacitor로 Android 앱 래핑.

## 실행
- 웹 확인: `python3 -m http.server 8000` 후 http://localhost:8000
- 카카오 키: `js/config.local.js` 에 `CONFIG.KAKAO_REST_KEY = '키';` (GitHub에 올리지 말 것)
- Android: `npm i @capacitor/core @capacitor/cli @capacitor/android` → `npx cap init` (webDir: .) → `npx cap add android` → `npx cap sync` → Android Studio에서 실행. 위치 권한(ACCESS_FINE_LOCATION) 필요.
