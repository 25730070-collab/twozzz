/* 화면 확인용 샘플 데이터 — data/segments_static.json 에서 32건을 발췌
   배열을 코드 안에 두는 5주차 방식이며, JSON 연결(fetch)은 이후 주차에 이 파일을 대체한다. */
const SEGMENTS = [
  {"segmentId":"seg-003","roadName":"백범로 5번 구간","roadType":"대로","accidentCount":7,"riskLevel":3,"address":"서울특별시 용산구 이태원동 백범로","lat":37.524579,"lng":126.99681,"source":"static"},
  {"segmentId":"seg-023","roadName":"테헤란로 3번 구간","roadType":"대로","accidentCount":14,"riskLevel":4,"address":"서울특별시 강남구 논현동 테헤란로","lat":37.530517,"lng":127.046012,"source":"static"},
  {"segmentId":"seg-025","roadName":"천호대로10길","roadType":"이면도로","accidentCount":2,"riskLevel":1,"address":"서울특별시 강동구 암사동 천호대로10길","lat":37.536252,"lng":127.121432,"source":"static"},
  {"segmentId":"seg-039","roadName":"마포대로53길","roadType":"이면도로","accidentCount":5,"riskLevel":2,"address":"서울특별시 마포구 상암동 마포대로53길","lat":37.560742,"lng":126.891835,"source":"static"},
  {"segmentId":"seg-048","roadName":"언주로 3번 구간","roadType":"대로","accidentCount":16,"riskLevel":4,"address":"서울특별시 강남구 논현동 언주로","lat":37.525798,"lng":127.058213,"source":"static"},
  {"segmentId":"seg-049","roadName":"잠실로57길","roadType":"이면도로","accidentCount":8,"riskLevel":3,"address":"서울특별시 송파구 문정동 잠실로57길","lat":37.528364,"lng":127.118392,"source":"static"},
  {"segmentId":"seg-052","roadName":"을지로 5번 구간","roadType":"대로","accidentCount":17,"riskLevel":4,"address":"서울특별시 중구 명동 을지로","lat":37.563913,"lng":126.996821,"source":"static"},
  {"segmentId":"seg-064","roadName":"상암동 15길 골목","roadType":"골목길","accidentCount":2,"riskLevel":1,"address":"서울특별시 마포구 상암동 15길 골목","lat":37.581207,"lng":126.895528,"source":"static"},
  {"segmentId":"seg-073","roadName":"역삼동 26길 골목","roadType":"골목길","accidentCount":5,"riskLevel":2,"address":"서울특별시 강남구 역삼동 26길 골목","lat":37.507008,"lng":127.059918,"source":"static"},
  {"segmentId":"seg-088","roadName":"신촌로9길","roadType":"이면도로","accidentCount":4,"riskLevel":2,"address":"서울특별시 서대문구 연희동 신촌로9길","lat":37.588876,"lng":126.938588,"source":"static"},
  {"segmentId":"seg-094","roadName":"국회대로 1번 구간","roadType":"대로","accidentCount":9,"riskLevel":3,"address":"서울특별시 영등포구 당산동 국회대로","lat":37.528546,"lng":126.885568,"source":"static"},
  {"segmentId":"seg-096","roadName":"방배로30길","roadType":"이면도로","accidentCount":9,"riskLevel":3,"address":"서울특별시 서초구 방배동 방배로30길","lat":37.470731,"lng":127.017613,"source":"static"},
  {"segmentId":"seg-097","roadName":"언주로43길","roadType":"이면도로","accidentCount":2,"riskLevel":1,"address":"서울특별시 강남구 삼성동 언주로43길","lat":37.505027,"lng":127.035279,"source":"static"},
  {"segmentId":"seg-122","roadName":"도산대로 5번 구간","roadType":"대로","accidentCount":8,"riskLevel":3,"address":"서울특별시 강남구 논현동 도산대로","lat":37.523105,"lng":127.057303,"source":"static"},
  {"segmentId":"seg-123","roadName":"송파대로 2번 구간","roadType":"대로","accidentCount":20,"riskLevel":4,"address":"서울특별시 송파구 가락동 송파대로","lat":37.501435,"lng":127.10191,"source":"static"},
  {"segmentId":"seg-138","roadName":"월드컵로 6번 구간","roadType":"대로","accidentCount":16,"riskLevel":4,"address":"서울특별시 마포구 상암동 월드컵로","lat":37.554263,"lng":126.912105,"source":"static"},
  {"segmentId":"seg-146","roadName":"방배로2길","roadType":"이면도로","accidentCount":5,"riskLevel":2,"address":"서울특별시 서초구 서초동 방배로2길","lat":37.486265,"lng":127.041468,"source":"static"},
  {"segmentId":"seg-147","roadName":"언주로12길","roadType":"이면도로","accidentCount":2,"riskLevel":1,"address":"서울특별시 강남구 논현동 언주로12길","lat":37.507169,"lng":127.047277,"source":"static"},
  {"segmentId":"seg-148","roadName":"송파대로14길","roadType":"이면도로","accidentCount":4,"riskLevel":2,"address":"서울특별시 송파구 가락동 송파대로14길","lat":37.516322,"lng":127.110939,"source":"static"},
  {"segmentId":"seg-152","roadName":"이태원동 16길 골목","roadType":"골목길","accidentCount":2,"riskLevel":1,"address":"서울특별시 용산구 이태원동 16길 골목","lat":37.545307,"lng":126.981554,"source":"static"},
  {"segmentId":"seg-170","roadName":"도산대로6길","roadType":"이면도로","accidentCount":8,"riskLevel":3,"address":"서울특별시 강남구 논현동 도산대로6길","lat":37.513451,"lng":127.049929,"source":"static"},
  {"segmentId":"seg-173","roadName":"명동 11길 골목","roadType":"골목길","accidentCount":5,"riskLevel":2,"address":"서울특별시 중구 명동 11길 골목","lat":37.578242,"lng":127.006147,"source":"static"},
  {"segmentId":"seg-192","roadName":"테헤란로 5번 구간","roadType":"대로","accidentCount":11,"riskLevel":4,"address":"서울특별시 강남구 삼성동 테헤란로","lat":37.503706,"lng":127.033821,"source":"static"},
  {"segmentId":"seg-193","roadName":"가락동 17길 골목","roadType":"골목길","accidentCount":5,"riskLevel":2,"address":"서울특별시 송파구 가락동 17길 골목","lat":37.504809,"lng":127.098079,"source":"static"},
  {"segmentId":"seg-207","roadName":"가좌로54길","roadType":"이면도로","accidentCount":7,"riskLevel":3,"address":"서울특별시 서대문구 신촌동 가좌로54길","lat":37.587682,"lng":126.949566,"source":"static"},
  {"segmentId":"seg-216","roadName":"논현동 14길 골목","roadType":"골목길","accidentCount":4,"riskLevel":2,"address":"서울특별시 강남구 논현동 14길 골목","lat":37.507276,"lng":127.047453,"source":"static"},
  {"segmentId":"seg-255","roadName":"연희로 3번 구간","roadType":"대로","accidentCount":20,"riskLevel":4,"address":"서울특별시 서대문구 홍제동 연희로","lat":37.59363,"lng":126.94483,"source":"static"},
  {"segmentId":"seg-265","roadName":"도산대로34길","roadType":"이면도로","accidentCount":3,"riskLevel":2,"address":"서울특별시 강남구 삼성동 도산대로34길","lat":37.505114,"lng":127.061466,"source":"static"},
  {"segmentId":"seg-267","roadName":"성내로 4번 구간","roadType":"대로","accidentCount":13,"riskLevel":4,"address":"서울특별시 강동구 천호동 성내로","lat":37.540099,"lng":127.115345,"source":"static"},
  {"segmentId":"seg-287","roadName":"송파대로 5번 구간","roadType":"대로","accidentCount":20,"riskLevel":4,"address":"서울특별시 송파구 가락동 송파대로","lat":37.504049,"lng":127.100376,"source":"static"},
  {"segmentId":"seg-291","roadName":"한강대로36길","roadType":"이면도로","accidentCount":4,"riskLevel":2,"address":"서울특별시 용산구 이태원동 한강대로36길","lat":37.520201,"lng":126.97678,"source":"static"},
  {"segmentId":"seg-310","roadName":"역삼동 19길 골목","roadType":"골목길","accidentCount":4,"riskLevel":2,"address":"서울특별시 강남구 역삼동 19길 골목","lat":37.509104,"lng":127.044342,"source":"static"}
];

/* 경로(route): 출발·도착 조합. 빠른 경로가 지나는 구간 id (순서 = 주행 순서)
   안전 경로는 common.js의 safeSegmentIds() 규칙으로 계산한다. */
const ROUTES = [
  {"id":"r1","origin":"강남역","destination":"잠실역","fastMin":22,"fastKm":11.4,"segmentIds":["seg-023","seg-073","seg-097","seg-122","seg-123","seg-192","seg-216","seg-265"]},
  {"id":"r2","origin":"역삼동","destination":"선릉역","fastMin":14,"fastKm":6.2,"segmentIds":["seg-048","seg-096","seg-146","seg-147","seg-170","seg-310"]},
  {"id":"r3","origin":"잠실대로","destination":"송파구청","fastMin":18,"fastKm":8.8,"segmentIds":["seg-025","seg-049","seg-148","seg-193","seg-267","seg-287"]},
  {"id":"r4","origin":"신촌역","destination":"홍대입구역","fastMin":16,"fastKm":7.1,"segmentIds":["seg-039","seg-064","seg-088","seg-138","seg-207","seg-255"]},
  {"id":"r5","origin":"서울역","destination":"여의도역","fastMin":19,"fastKm":9.6,"segmentIds":["seg-003","seg-052","seg-094","seg-152","seg-173","seg-291"]}
];

/* 초보 연습 코스: 안전 경로 기준으로 추천 */
const COURSES = [
  { id: 'c1', routeId: 'r1', title: '강남~잠실 큰길 코스', desc: '대로 위주라 차선이 넓고 골목 진입이 적어요', tags: ['직진 위주', '주말 낮 추천'] },
  { id: 'c2', routeId: 'r2', title: '역삼~선릉 단거리 코스', desc: '짧은 거리로 교차로 대처를 반복 연습', tags: ['단거리', '교차로 연습'] },
  { id: 'c3', routeId: 'r3', title: '송파 생활권 코스', desc: '이면도로 구간이 섞여 있어 서행 연습에 좋아요', tags: ['이면도로', '서행 연습'] },
  { id: 'c4', routeId: 'r4', title: '신촌~홍대 번화가 코스', desc: '보행자가 많은 도심 감각 익히기', tags: ['보행자 많음', '도심'] },
  { id: 'c5', routeId: 'r5', title: '서울역~여의도 코스', desc: '합류 구간이 많아 차로 변경 연습에 적합', tags: ['합류 구간', '차로 변경'] }
];

/* LocalStorage가 비어 있을 때만 넣는 초기값 (사용자 상태는 JSON이 아니라 LocalStorage) */
const RECENT_SEED = [
  { id: 'rc1', origin: '강남역', destination: '잠실역', at: '10/19 14:20' },
  { id: 'rc2', origin: '역삼동', destination: '선릉역', at: '10/17 09:15' },
  { id: 'rc3', origin: '신촌역', destination: '홍대입구역', at: '10/15 21:03' },
  { id: 'rc4', origin: '서울역', destination: '여의도역', at: '10/12 18:42' },
  { id: 'rc5', origin: '잠실대로', destination: '송파구청', at: '10/07 08:30' }
];
const FAV_SEED = [
  { id: 'fv1', kind: 'route', origin: '강남역', destination: '잠실역', savedAt: '10/08' },
  { id: 'fv2', kind: 'route', origin: '신촌역', destination: '홍대입구역', savedAt: '10/05' },
  { id: 'fv3', kind: 'segment', segmentId: 'seg-023', savedAt: '10/03' }
];
const DRILL_SEED = [
  { id: 'dr1', origin: '강남역', destination: '잠실역', routeType: 'safe', points: 3, at: '10/18 20:10' },
  { id: 'dr2', origin: '신촌역', destination: '홍대입구역', routeType: 'fast', points: 5, at: '10/16 19:40' }
];

/* 학습 카드 : 위험 유형별 대처법 */
const LEARN = [
  { t: '우회전 차량 · 보행자', steps: ['횡단보도 앞에서 일단 멈춤', '보행자가 완전히 지나간 뒤 출발', '뒤차가 재촉해도 서두르지 않기'] },
  { t: '비보호 좌회전', steps: ['직진 차량 간격을 먼저 확인', '교차로 안에서 기다리며 정지선 넘기', '애매하면 다음 신호 기다리기'] },
  { t: '이면도로 · 골목길', steps: ['시속 30km 이하로 서행', '주정차 차량 사이 보행자 주의', '코너에서는 일단 멈춰 확인'] },
  { t: '비 오는 날', steps: ['차간거리 평소의 2배', '급제동·급핸들 금지', '와이퍼·전조등 출발 전 점검'] }
];
const TIPS = [
  { t: '교차로 진입 전 한 번 더', d: '신호가 바뀌는 순간에도 좌우를 확인하고 천천히 진입하세요.' },
  { t: '초행길은 미리 한 번 가보기', d: '모의주행으로 위험 지점 순서를 익히면 실제 운전에서 덜 당황해요.' },
  { t: '내비는 음성 위주로', d: '화면을 오래 보지 말고 안내 음성에 맞춰 차로를 준비하세요.' },
  { t: '위험 구간 앞에서는 감속', d: '3~4등급 구간은 평소보다 속도를 줄이고 차간거리를 넓히세요.' }
];
