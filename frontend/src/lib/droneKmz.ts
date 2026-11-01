/**
 * 플라이스루 웨이포인트를 DJI Fly 웨이포인트 파일(KMZ)로 만듭니다.
 *
 * DJI Fly 에는 가져오기 버튼이 없습니다. 앱에서 저장한 빈 경로의 KMZ 를 이 파일로
 * 덮어써야 합니다(비공식). DJI 가 Mini 4 Pro 값을 공개하지 않아, 현장 검증을 밝힌
 * GeoFly-QGIS 의 프로필(드론 67, 페이로드 53, 네임스페이스 1.0.6)을 따릅니다.
 *
 * 기수는 followWayline 입니다 - dronePlan 의 기수도 다음 점을 보므로 같습니다.
 * 고도는 이륙 지점 기준이라 ① 근처 지면에서 이륙해야 계획대로 납니다.
 */

import { MISSION_SPEED, type HolePlan, type Waypoint } from '@/lib/dronePlan';

const NS = 'http://www.dji.com/wpmz/1.0.6';

const missionConfig = (payload: string) => `<wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>noAction</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${MISSION_SPEED.toFixed(1)}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>67</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>${payload}
    </wpml:missionConfig>`;

const PAYLOAD = `
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>53</wpml:payloadEnumValue>
        <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
        <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      </wpml:payloadInfo>`;

function templateKml(plan: HolePlan, now: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${NS}">
  <Document>
    <wpml:author>Pelham Hills</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>
    ${missionConfig('')}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:globalHeight>${plan.route[0].altitude.toFixed(2)}</wpml:globalHeight>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${MISSION_SPEED.toFixed(1)}</wpml:autoFlightSpeed>
      <wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>
      <wpml:globalWaypointTurnMode>coordinateTurn</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
    </Folder>
  </Document>
</kml>`;
}

const action = (id: number, func: string, params: string) => `          <wpml:action>
            <wpml:actionId>${id}</wpml:actionId>
            <wpml:actionActuatorFunc>${func}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
${params}
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;

const PAYLOAD_INDEX = '              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>';

const gimbal = (id: number, pitch: number) =>
  action(
    id,
    'gimbalRotate',
    `              <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${pitch}</wpml:gimbalPitchRotateAngle>
              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
              <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
              <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>
              <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
${PAYLOAD_INDEX}`
  );

/** 점마다 짐벌, ①은 2.5초 멈춰 짐벌이 자리 잡은 뒤 녹화 시작, 마지막 점은 녹화 중지. */
function actionGroup(w: Waypoint, i: number, last: number): string {
  const actions = [gimbal(0, w.gimbal)];
  if (i === 0) {
    actions.push(action(1, 'hover', '              <wpml:hoverTime>2.5</wpml:hoverTime>'));
    actions.push(action(2, 'startRecord', PAYLOAD_INDEX));
  }
  if (i === last) actions.push(action(1, 'stopRecord', PAYLOAD_INDEX));
  return `        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>
${actions.join('\n')}
        </wpml:actionGroup>`;
}

function waylinesWpml(plan: HolePlan): string {
  const last = plan.route.length - 1;
  const marks = plan.route.map(
    (w, i) => `      <Placemark>
        <wpml:index>${i}</wpml:index>
        <Point>
          <coordinates>${w.at[1].toFixed(8)},${w.at[0].toFixed(8)},0</coordinates>
        </Point>
        <wpml:executeHeight>${w.altitude.toFixed(2)}</wpml:executeHeight>
        <wpml:waypointSpeed>${MISSION_SPEED.toFixed(1)}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>coordinateTurn</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0.2</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
${actionGroup(w, i, last)}
      </Placemark>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${NS}">
  <Document>
    ${missionConfig(PAYLOAD)}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${MISSION_SPEED.toFixed(1)}</wpml:autoFlightSpeed>
${marks.join('\n')}
    </Folder>
  </Document>
</kml>`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 압축 없는(stored) ZIP. 파일 둘에 라이브러리를 들이지 않습니다. */
function zip(files: { name: string; text: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const header = (size: number, write: (v: DataView) => void) => {
    const out = new Uint8Array(size);
    write(new DataView(out.buffer));
    return out;
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true); // 필요한 버전
      v.setUint16(at + 2, 0x0800, true); // UTF-8
      v.setUint16(at + 4, 0, true); // stored
      v.setUint16(at + 6, 0, true); // 시각
      v.setUint16(at + 8, 0x21, true); // 날짜 1980-01-01
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, name.length, true);
    };
    const local = header(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      common(v, 4);
    });
    central.push(
      header(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        common(v, 6);
        v.setUint32(42, offset, true);
      }),
      name
    );
    chunks.push(local, name, data);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });

  const parts = [...chunks, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const kmzName = (p: HolePlan) => `pelham-hole-${String(p.hole.holeNumber).padStart(2, '0')}.kmz`;

export function holeKmz(plan: HolePlan, now = Date.now()): Uint8Array<ArrayBuffer> {
  return zip([
    { name: 'template.kml', text: templateKml(plan, now) },
    { name: 'waylines.wpml', text: waylinesWpml(plan) },
  ]);
}
