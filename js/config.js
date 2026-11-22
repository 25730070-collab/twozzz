/* config.js — 설정값 (키는 여기에 쓰지 말고 config.local.js 에 넣는다. config.local.js 는 .gitignore 대상) */
const CONFIG = {
  API_URL: '',                   // 회원 서버(server/) 주소. 비워 두면 '이 사이트와 같은 주소'를 먼저 확인하고, 서버가 없으면 실습 모드(이 기기에만 저장)로 동작한다. 예: 'https://내서버.example.com'
  KAKAO_REST_KEY: '212e7bedc2050b743c0ad253fb9e79bd',            // 카카오 REST API 키 (길찾기·장소 검색). 비어 있으면 경로 기능은 '연결 전' 화면을 보여 준다
  DIRECTIONS_URL: 'https://apis-navi.kakaomobility.com/v1/directions',
  LOCAL_SEARCH_URL: 'https://dapi.kakao.com/v2/local/search/keyword.json',
  HAZARD_RADIUS_M: 120,          // 경로에서 이 거리 안에 있는 사고 다발지점을 '지나는 지점'으로 센다
  SAFE_TIME_LIMIT: 1.35,         // 안전 경로는 빠른 경로 시간의 1.35배까지만 허용
  DETOUR_CALLS: 8,               // 더 안전한 경로를 찾으려고 '우회 경유지'로 길찾기를 부르는 최대 횟수 (경로 한 번당)
  ALERT_M: 300,                  // 사고 다발지점 접근 알림 거리
  TURN_ANNOUNCE_M: 300,          // 회전 안내 음성 거리
  OFFROUTE_M: 60,                // 경로 이탈 판단 거리
  OFFROUTE_COUNT: 5              // 연속 몇 번 벗어나면 재탐색할지
};
