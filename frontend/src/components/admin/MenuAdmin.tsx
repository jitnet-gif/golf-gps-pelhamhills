import { useEffect, useState, type FormEvent } from 'react';
import { Camera, ImageOff, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { deleteMenuPhoto, PHOTO_PROBLEM_TEXT, uploadMenuPhoto } from '@/lib/menuPhotos';
import { menuPhoto } from '@/data/menuImages';
import {
  DEFAULT_ORDER_SETTINGS,
  deleteMenuItem,
  fetchMenu,
  fetchOrderSettings,
  money,
  saveMenuItem,
  saveOrderSettings,
  type MenuItem,
  type MenuItemInput,
  type OrderSettings,
} from '@/lib/foodOrders';
import type { ServerProblem } from '@/lib/holePaths';

const PROBLEM: Record<ServerProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없습니다.',
  signedOut: '관리자 계정으로 로그인해 주세요.',
  notAdmin: '이 계정은 관리자로 지정되지 않았습니다 (0006 SQL 맨 아래 관리자 지정).',
  missingTable: '서버에 menu_items 표가 없습니다. 0012_food_orders.sql 을 SQL Editor 에서 실행해 주세요.',
  network: '인터넷 연결이 없어 저장하지 못했습니다.',
  other: '저장하지 못했습니다. 잠시 후 다시 눌러 주세요.',
};

const EMPTY: MenuItemInput = {
  name: '',
  description: '',
  category: '',
  priceCents: 0,
  isAvailable: true,
  sortOrder: 0,
  imageUrl: null,
};

/** 화면에서는 달러로 입력받고 센트로 저장합니다 - 반올림을 한 곳에서만 합니다. */
const toCents = (dollars: string): number => Math.max(0, Math.round(Number(dollars.replace(/[^0-9.]/g, '')) * 100));
const toDollars = (cents: number): string => (cents / 100).toFixed(2);

const field = 'h-11 w-full rounded-md border border-border bg-background px-3 text-base';

/**
 * 메뉴 관리
 *
 * 클럽이 파는 것과 가격을 여기서 정합니다. 선수 폰의 주문 화면(/food)은 이 표를
 * 그대로 읽고, 주문이 들어올 때 값은 서버가 이 표에서 다시 계산합니다 - 폰이
 * 보낸 가격은 쓰지 않습니다.
 *
 * 품절은 지우지 말고 '품절'로 꺼 두세요. 지우면 지난 주문의 이름이 남지 않습니다
 * (주문에는 그때의 이름과 값이 박혀 있으니 영수증은 그대로입니다).
 */
export function MenuAdmin() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MenuItemInput>(EMPTY);
  const [draftPrice, setDraftPrice] = useState('');
  const [settings, setSettings] = useState<OrderSettings>(DEFAULT_ORDER_SETTINGS);
  // 사진을 올리고 있는 줄. 45 줄을 한 장씩 찍는 화면이라, 어느 줄이 도는지
  // 보이지 않으면 클럽이 같은 줄을 두 번 누릅니다.
  const [uploading, setUploading] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState('');
  const [settingsNote, setSettingsNote] = useState('');

  const reload = async () => {
    const { items: rows, problem: failed } = await fetchMenu();
    setProblem(failed);
    if (rows) setItems(rows);
  };

  useEffect(() => {
    void reload();
    void fetchOrderSettings().then(setSettings);
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    setNote('');
    const { item, problem: failed } = await saveMenuItem(null, {
      ...draft,
      priceCents: toCents(draftPrice),
      sortOrder: items.length,
    });
    setBusy(false);
    if (failed || !item) {
      setProblem(failed ?? 'other');
      return;
    }
    setProblem(null);
    setItems((current) => [...current, item]);
    setDraft(EMPTY);
    setDraftPrice('');
    setNote(`${item.name} 을(를) 메뉴에 넣었습니다.`);
  };

  const patch = async (item: MenuItem, changes: Partial<MenuItemInput>) => {
    setBusy(true);
    const { item: saved, problem: failed } = await saveMenuItem(item.id, { ...item, ...changes });
    setBusy(false);
    if (failed || !saved) {
      setProblem(failed ?? 'other');
      return;
    }
    setProblem(null);
    setItems((current) => current.map((row) => (row.id === saved.id ? saved : row)));
  };

  /**
   * 한 줄에 사진 한 장.
   *
   * 올리기 -> 주소를 그 줄에 저장 -> 저장이 되면 예전 사진을 지웁니다. 순서가
   * 중요합니다: 먼저 지우면 저장이 실패했을 때 사진도 주소도 없어집니다.
   */
  const setPhoto = async (item: MenuItem, file: File) => {
    setUploading(item.id);
    setPhotoNote('');
    const { url, problem: failed } = await uploadMenuPhoto(item.id, file);
    if (!url) {
      setUploading(null);
      setPhotoNote(PHOTO_PROBLEM_TEXT[failed ?? 'other']);
      return;
    }

    const previous = item.imageUrl;
    const { item: saved, problem: saveFailed } = await saveMenuItem(item.id, {
      ...item,
      imageUrl: url,
    });
    setUploading(null);

    if (!saved) {
      // 줄에 붙지 못한 사진은 통에 남겨 둘 이유가 없습니다.
      void deleteMenuPhoto(url);
      setProblem(saveFailed ?? 'other');
      return;
    }
    setProblem(null);
    setItems((current) => current.map((row) => (row.id === saved.id ? saved : row)));
    void deleteMenuPhoto(previous);
    setPhotoNote(`${saved.name} 사진을 올렸습니다.`);
  };

  const clearPhoto = async (item: MenuItem) => {
    const previous = item.imageUrl;
    await patch(item, { imageUrl: null });
    void deleteMenuPhoto(previous);
  };

  const remove = async (item: MenuItem) => {
    if (!window.confirm(`${item.name} 을(를) 메뉴에서 지울까요? 품절이면 지우지 말고 '판매' 를 꺼 두세요.`)) return;
    setBusy(true);
    const failed = await deleteMenuItem(item.id);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
  };

  const saveHours = async () => {
    // The database takes whatever is saved here and refuses every order that
    // falls outside it, so a backwards window would quietly shut the shop.
    if (!settings.open || !settings.close || settings.close <= settings.open) {
      setSettingsNote('닫는 시간은 여는 시간보다 늦어야 합니다.');
      return;
    }
    if (!(settings.leadMinutes >= 0 && settings.leadMinutes <= 180)) {
      setSettingsNote('준비 시간은 0~180분 사이로 넣어 주세요.');
      return;
    }
    if (!(settings.slotMinutes >= 5 && settings.slotMinutes <= 60)) {
      setSettingsNote('시간 간격은 5~60분 사이로 넣어 주세요.');
      return;
    }
    setBusy(true);
    setSettingsNote('');
    const failed = await saveOrderSettings(settings);
    setBusy(false);
    setSettingsNote(failed ? PROBLEM[failed] : '주문 시간을 저장했습니다.');
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">주문 받는 시간</h2>
          <p className="text-sm text-muted-foreground">
            선수는 이 시간 안에서만, 준비 시간이 지난 뒤부터 {settings.slotMinutes}분 단위로 픽업 시간을 고릅니다.
            저장하면 열려 있는 주문 화면에도 1분 안에 반영됩니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm font-medium">
            여는 시간
            <input
              type="time"
              value={settings.open}
              onChange={(e) => setSettings({ ...settings, open: e.target.value })}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            닫는 시간
            <input
              type="time"
              value={settings.close}
              onChange={(e) => setSettings({ ...settings, close: e.target.value })}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            준비 시간(분)
            <input
              type="number"
              min={0}
              max={180}
              value={settings.leadMinutes}
              onChange={(e) => setSettings({ ...settings, leadMinutes: Number(e.target.value) })}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            시간 간격(분)
            <input
              type="number"
              min={5}
              max={60}
              step={5}
              value={settings.slotMinutes}
              onChange={(e) => setSettings({ ...settings, slotMinutes: Number(e.target.value) })}
              className={`${field} mt-1`}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            className="h-5 w-5"
          />
          지금 주문 받기 (끄면 선수 화면이 전화 안내로 바뀝니다)
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveHours()}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            저장
          </button>
          {settingsNote && <span className="text-sm text-muted-foreground">{settingsNote}</span>}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">메뉴 {items.length}개</h2>
          <p className="text-sm text-muted-foreground">
            분류(Snacks, Drinks 같은 묶음)는 자유롭게 쓰면 선수 화면이 그 묶음으로 보여 줍니다.
          </p>
        </div>

        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {PROBLEM[problem]}
          </p>
        )}
        {note && <p className="text-sm text-green-700 dark:text-green-400">{note}</p>}
        {photoNote && <p className="text-sm text-muted-foreground">{photoNote}</p>}

        <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          줄마다 사진 한 장을 올릴 수 있습니다. 인쇄 메뉴판에는 사진이 없으니 프로 샵에서
          직접 찍어 올리시면 됩니다 - 폰으로 찍은 그대로 올려도 앱이 알아서 줄여 보냅니다.
          사진이 없는 줄은 지금까지처럼 글자만 나옵니다.
        </p>

        <form onSubmit={add} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-6">
          <label className="sm:col-span-2 text-sm font-medium">
            이름
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={80}
              required
              className={`${field} mt-1`}
            />
          </label>
          <label className="sm:col-span-2 text-sm font-medium">
            설명 (선택)
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={200}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            분류
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              maxLength={40}
              placeholder="Snacks"
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-sm font-medium">
            가격 ($)
            <input
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              inputMode="decimal"
              placeholder="8.50"
              className={`${field} mt-1`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !draft.name.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:col-span-6"
          >
            <Plus className="h-4 w-4" />
            메뉴에 넣기
          </button>
        </form>

        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
              {/* 사진 칸. 레이블 안에 숨긴 file 입력이라, 사진을 누르면 곧바로
                  폰의 카메라/앨범이 열립니다. capture 를 강제하지는 않습니다 -
                  프로 샵이 이미 찍어 둔 사진을 고를 수도 있어야 합니다. */}
              <label
                className="relative grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border bg-muted"
                title={item.imageUrl ? '사진 바꾸기' : '사진 올리기'}
              >
                <span className="sr-only">{item.name} 사진</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // 같은 파일을 다시 고를 수 있게 비워 둡니다.
                    e.target.value = '';
                    if (file) void setPhoto(item, file);
                  }}
                  className="sr-only"
                />
                {menuPhoto(item.id, item.imageUrl) ? (
                  <img
                    src={menuPhoto(item.id, item.imageUrl)!}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera className="h-5 w-5 text-muted-foreground" />
                )}
                {uploading === item.id && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                )}
              </label>
              {/* 인쇄 메뉴판 사진은 앱에 들어 있어 지울 것이 없습니다. 올린
                  사진을 지우면 그 줄은 다시 메뉴판 사진으로 돌아갑니다. */}
              {item.imageUrl && (
                <button
                  type="button"
                  onClick={() => void clearPhoto(item)}
                  disabled={busy || uploading !== null}
                  aria-label={`${item.name} 사진 지우기`}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  <ImageOff className="h-4 w-4" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {item.name}
                  {item.category && <span className="ml-2 text-xs text-muted-foreground">{item.category}</span>}
                </p>
                {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
              </div>
              <label className="text-sm font-medium">
                <span className="sr-only">{item.name} 가격</span>
                <input
                  defaultValue={toDollars(item.priceCents)}
                  onBlur={(e) => {
                    const cents = toCents(e.target.value);
                    if (cents !== item.priceCents) void patch(item, { priceCents: cents });
                    e.target.value = toDollars(cents);
                  }}
                  inputMode="decimal"
                  className="h-11 w-24 rounded-md border border-border bg-background px-3 text-base tabular-nums"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={item.isAvailable}
                  onChange={(e) => void patch(item, { isAvailable: e.target.checked })}
                  className="h-5 w-5"
                />
                판매
              </label>
              <button
                type="button"
                onClick={() => void remove(item)}
                disabled={busy}
                aria-label={`${item.name} 지우기`}
                className="grid h-11 w-11 place-items-center rounded-md text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {items.length === 0 && !problem && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            아직 메뉴가 없습니다. 위에서 하나씩 넣으면 선수 폰에 바로 보입니다.
          </p>
        )}
        {items.length > 0 && (
          <p className="text-sm text-muted-foreground">
            합계 {items.filter((i) => i.isAvailable).length}개 판매 중 · 가장 비싼 것{' '}
            {money(Math.max(...items.map((i) => i.priceCents)))}
          </p>
        )}
      </section>
    </div>
  );
}
