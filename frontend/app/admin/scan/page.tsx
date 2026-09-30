import RetailWorkspace from "@/components/retail/RetailWorkspace";

// 카메라 스캔 바로가기. 휴대폰·아이패드 홈 화면에 붙여 두면 누르자마자 카메라가 켜진
// 계산대로 열린다. 프로 샵 계산대와 같은 한 벌이라 담은 물건은 같은 계산서에 보인다.
export default function ScanPage() {
  return <RetailWorkspace startWithCamera title="Camera Scan" />;
}
