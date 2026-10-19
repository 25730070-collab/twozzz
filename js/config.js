/* config.js — 설정값 (키는 여기에 쓰지 말고 config.local.js 에 넣는다) */
const CONFIG = {
  KAKAO_REST_KEY: '',            // 카카오 REST API 키. 비어 있으면 '데모 모드'(샘플 경로)로 동작
  DIRECTIONS_URL: 'https://apis-navi.kakaomobility.com/v1/waypoints/directions',
  LOCAL_SEARCH_URL: 'https://dapi.kakao.com/v2/local/search/keyword.json',
  HAZARD_RADIUS_M: 120,          // 경로에서 이 거리 안의 사고다발지점을 '지나는 위험 구간'으로 센다
  SAFE_TIME_LIMIT: 1.35,         // 안전 경로는 빠른 경로 시간의 1.35배까지만 허용
  ALERT_M: 300,                  // 위험 구간 접근 알림 거리
  TURN_ANNOUNCE_M: 300,          // 회전 안내 음성 거리
  OFFROUTE_M: 60,                // 경로 이탈 판단 거리
  OFFROUTE_COUNT: 5              // 연속 몇 번 벗어나면 재탐색할지
};
