import { createPortal } from 'react-dom';
import { clockTime, money, type ShopOrder } from '@/lib/foodOrders';

/**
 * 주문서 한 장 (계산대 영수증)
 *
 * 프로 샵이 화면 대신 손에 들고 움직이는 종이입니다. 주방에 붙여 두고, 봉투에
 * 끼워 손님에게 건넵니다.
 *
 * 80 mm 감열 프린터를 기준으로 짰습니다(index.css 의 @page). A4 로 뽑아도
 * 글자가 깨지지는 않습니다 - 종이 왼쪽에 좁게 나올 뿐입니다.
 *
 * 화면에는 보이지 않습니다. 인쇄할 때만 나타나고, 그때는 반대로 이 종이만
 * 남고 운영 화면이 통째로 숨습니다(index.css 의 @media print).
 *
 * body 바로 밑에 붙입니다(createPortal). 인쇄 규칙이 body 의 자식을 통째로
 * 숨기기 때문에, React 트리 안에 있으면 #root 와 함께 딸려 사라집니다.
 *
 * 여기 적는 것은 계산대에서 필요한 것만입니다:
 *   - 픽업 시간과 코드. 손님이 와서 대는 것이 이 둘입니다.
 *   - 품목과 값. 값은 주문한 순간 서버가 박아 둔 값이고, 그 뒤 메뉴 가격이
 *     바뀌어도 이 종이의 값은 그대로입니다.
 *   - 이름과 전화. 늦거나 못 찾을 때 거는 번호입니다.
 *   - 몇 번 홀에서 시켰는지. 언제쯤 도착할지 가늠하는 데 씁니다.
 *
 * 값을 받는 것은 계산대입니다. 카운터가 결제를 찍기 전(paidAt 없음)에는
 * 'PAY AT THE COUNTER' 를, 찍은 뒤에는 어떻게 받았는지를 적습니다 - 현금이면
 * 받은 돈과 거스름돈, 카드면 끝 4자리와 승인번호(0021). 카드 번호 전체는
 * 어디에도 없으므로 여기에도 없습니다.
 */

const METHOD_EN = { cash: 'CASH', card: 'CARD', member: 'MEMBER ACCOUNT' } as const;

const CLUB_NAME = 'Pelham Hills Golf & Country Club';
const CLUB_PHONE = '+1 (905) 735-6768';

interface OrderReceiptProps {
  order: ShopOrder;
}

export function OrderReceipt({ order }: OrderReceiptProps) {
  const placed = new Date(order.createdAt);

  return createPortal(
    <div id="order-receipt" className="receipt-sheet" aria-hidden>
      <p className="receipt-club">{CLUB_NAME}</p>
      <p className="receipt-sub">Pro Shop · {CLUB_PHONE}</p>

      <hr className="receipt-rule" />

      <p className="receipt-code">{order.code}</p>
      <p className="receipt-pickup">
        PICKUP <strong>{clockTime(order.pickupAt)}</strong>
      </p>

      <hr className="receipt-rule" />

      <table className="receipt-items">
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td className="receipt-qty">{item.quantity}</td>
              <td className="receipt-name">{item.name}</td>
              <td className="receipt-amount">{money(item.price_cents * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="receipt-total-label">
              TOTAL
            </td>
            <td className="receipt-amount receipt-total-label">{money(order.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <hr className="receipt-rule" />

      {/* 결제 줄. 이 종이에서 제일 중요한 줄입니다. */}
      {order.paidAt && order.paidMethod ? (
        <>
          <p className="receipt-pay">PAID · {METHOD_EN[order.paidMethod]}</p>
          <table className="receipt-items">
            <tbody>
              {order.paidMethod === 'cash' && order.paidCashCents !== null && (
                <>
                  <tr>
                    <td className="receipt-name">Cash tendered</td>
                    <td className="receipt-amount">{money(order.paidCashCents)}</td>
                  </tr>
                  <tr>
                    <td className="receipt-name">Change</td>
                    <td className="receipt-amount">
                      {money(order.paidCashCents - order.totalCents)}
                    </td>
                  </tr>
                </>
              )}
              {order.paidMethod === 'card' && order.paidCardLast4 && (
                <tr>
                  <td className="receipt-name">Card</td>
                  <td className="receipt-amount">**** {order.paidCardLast4}</td>
                </tr>
              )}
              {order.paidMethod === 'card' && order.paidCardAuth && (
                <tr>
                  <td className="receipt-name">Auth</td>
                  <td className="receipt-amount">{order.paidCardAuth}</td>
                </tr>
              )}
              <tr>
                <td className="receipt-name">Paid</td>
                <td className="receipt-amount">{clockTime(order.paidAt)}</td>
              </tr>
            </tbody>
          </table>
          <hr className="receipt-rule" />
        </>
      ) : (
        <p className="receipt-pay">PAY AT THE COUNTER</p>
      )}

      <p className="receipt-line">
        {order.customerName} · {order.phone}
      </p>
      {order.holeNumber !== null && (
        <p className="receipt-line">Ordered from hole {order.holeNumber}</p>
      )}
      {order.note && <p className="receipt-note">NOTE: {order.note}</p>}

      <p className="receipt-line receipt-placed">
        Placed {placed.toLocaleDateString()} {clockTime(placed)}
      </p>
    </div>,
    document.body
  );
}
