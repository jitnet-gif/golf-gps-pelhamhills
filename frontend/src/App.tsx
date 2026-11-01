import { Router, Route } from 'wouter';
import Home from './pages/Home';
import Golf from './pages/Golf';
import Admin from './pages/Admin';
import Book from './pages/Book';
import Food from './pages/Food';
import Counter from './pages/Counter';
import Coupons from './pages/Coupons';
import Checkin from './pages/Checkin';
import MyQr from './pages/MyQr';
import Join from './pages/Join';
import { UpdateNotice } from './components';
import { useOfflineMode } from './hooks';

export default function App() {
  // Keeps the store's online flag honest for every screen under the router.
  useOfflineMode();

  /* 서비스워커 등록은 여기서 하지 않습니다. 등록과 업데이트 확인은 한 군데
     (src/lib/appUpdate.ts)에 모여 있고, UpdateNotice 가 마운트되면서
     useAppUpdate 를 통해 시작합니다 - 등록이 두 번 일어나면 업데이트를
     기다리는 워커를 누가 깨우는지가 불분명해집니다. */

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground">
        {/* 라우터 안 모든 화면 위에 뜹니다. 평소에는 아무것도 그리지 않고,
            라운드 중처럼 새로고침이 비싼 화면에서만 탭을 기다립니다. */}
        <UpdateNotice />
        <Route path="/" component={Home} />
        <Route path="/book" component={Book} />
        <Route path="/food" component={Food} />
        <Route path="/coupons" component={Coupons} />
        {/* 카운터 NFC 스티커가 여는 주소(0024). */}
        <Route path="/checkin" component={Checkin} />
        {/* 프로 샵이 준 손님 QR 이 여는 주소(pelhamhills 0084). */}
        <Route path="/me" component={MyQr} />
        {/* 회원 카드·비회원 쿠폰북 가입(0031). */}
        <Route path="/join" component={Join} />
        <Route path="/golf/:courseId" component={Golf} />
        {/* 운영자용. 플레이어에게는 링크로 노출하지 않습니다 - 주소를 아는
            사람만 들어오고, 실제 차단은 화면이 아니라 서버의 X-Admin-Key가
            합니다. 예외는 관리자 키를 넣은 탭에만 보이는 '지도 수정' 링크와
            클럽 어드민 사이드바의 Course Map(/admin/map), CCTV(/admin/cctv) 메뉴입니다.
            :section? 하나로 받아야 /admin <-> /admin/map 을 오갈 때 화면이
            다시 마운트되지 않습니다. */}
        <Route path="/admin/:section?" component={Admin} />
        {/* 프로 샵 계산대 화면. /admin 과 달리 관리자 키를 묻지 않습니다 -
            아침에 한 번 로그인해 하루 종일 켜 두는 화면이라, 비밀을 두 개
            외우게 할 값이 없습니다. 무엇을 할 수 있는지는 서버의 행 보안이
            계정으로 정합니다(0006 scorecard_admins). */}
        <Route path="/fnb" component={Counter} />
      </div>
    </Router>
  );
}
