-- ============================================================================
-- 0015 메뉴 사진
-- ============================================================================
--
-- 주문 화면(/food)의 45 줄이 지금은 글자뿐입니다. 손님이 "Strawblaw" 가
-- 무엇인지 알 방법이 없습니다. 줄마다 사진 한 장을 붙입니다.
--
-- 먼저 실행해야 하는 것:
--   0012_food_orders.sql  - menu_items 표. 없으면 이 파일은 아무것도 하지 않고
--                           조용히 끝납니다(아래 DO 블록).
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 사진 자체는 클럽이 /admin > 메뉴 에서 한 줄씩 올립니다. 인쇄 메뉴판에는
-- 사진이 없으므로 이 파일이 넣어 줄 것이 없습니다 - 올리기 전까지 그 줄은
-- 지금까지와 똑같이 글자만 나옵니다.
--
-- ----------------------------------------------------------------------------
-- 사진은 어디에 두는가
-- ----------------------------------------------------------------------------
-- Supabase Storage 의 'menu-photos' 통에 둡니다. 표에는 주소만 적습니다.
-- 사진을 표 안에 base64 로 넣으면 메뉴 한 번 읽는 데 몇 MB 가 되고, 그 읽기는
-- 손님이 페어웨이에서 하는 읽기입니다.
--
-- 통은 공개입니다. 핫도그 사진은 감출 것이 없고, 공개가 아니면 서명 주소를
-- 계속 새로 발급해야 해서 오프라인에서 캐시된 메뉴의 사진이 깨집니다.
-- 올리고 지우는 것은 관리자(is_scorecard_admin)만 됩니다.
-- ============================================================================

DO $photos$
BEGIN

IF to_regclass('public.menu_items') IS NULL THEN
  RAISE NOTICE 'menu_items 표가 없습니다. 0012_food_orders.sql 을 먼저 실행하세요.';
  RETURN;
END IF;

-- 주소만 답니다. 길이를 막아 두는 것은 누가 base64 를 통째로 넣는 것을
-- 막기 위해서입니다 - 그러면 메뉴 읽기가 다시 무거워집니다.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_image_url_shape;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_image_url_shape CHECK (
    image_url IS NULL
    OR (image_url LIKE 'https://%' AND length(image_url) <= 500)
  );

END
$photos$;

-- ----------------------------------------------------------------------------
-- 사진 통
-- ----------------------------------------------------------------------------
-- **여기서부터는 실패해도 위의 image_url 칸은 남습니다.**
--
-- 처음 쓴 판은 이 아래를 그냥 나열했습니다. SQL Editor 는 붙여 넣은 전부를 한
-- 트랜잭션으로 돌리기 때문에, 맨 아래 CREATE POLICY 한 줄이 권한 때문에
-- 실패하면 **맨 위의 ALTER TABLE 까지 통째로 되돌아갑니다** - 화면에는 빨간
-- 줄 하나만 뜨고, 사람은 "정책만 안 됐구나" 로 읽습니다. 실제로는 아무것도
-- 안 들어간 상태였습니다.
--
-- storage.objects 는 supabase_storage_admin 것이라, SQL Editor 계정이
-- 정책을 못 만드는 프로젝트가 흔합니다("must be owner of table objects").
-- 그래서 통과 정책은 각각 따로 감싸고, 안 되면 넘어가면서 무엇을 손으로
-- 해야 하는지 알려 줍니다. Run 한 뒤 아래 Messages/Notices 를 보세요.
-- ----------------------------------------------------------------------------

DO $bucket$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'menu-photos', 'menu-photos', true,
    -- 2 MB. 앱이 올리기 전에 긴 변 1000 px JPEG 로 줄이므로 200 KB 안쪽입니다.
    -- 이 한도는 앱을 거치지 않고 올리는 경우를 위한 것입니다.
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
  ON CONFLICT (id) DO UPDATE SET
    public             = EXCLUDED.public,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

  RAISE NOTICE 'menu-photos 통을 만들었습니다.';
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE '통을 만들 권한이 없습니다. 대시보드 > Storage > New bucket 에서 이름 menu-photos, Public 켜서 손으로 만드세요.';
END
$bucket$;

DO $policies$
DECLARE
  made integer := 0;
  wanted text[] := ARRAY[
    -- 보는 것은 누구나(로그인하지 않은 손님이 주문 화면을 엽니다).
    $p$CREATE POLICY "menu_photos_read_all" ON storage.objects
         FOR SELECT TO anon, authenticated
         USING (bucket_id = 'menu-photos')$p$,
    -- 올리고 바꾸고 지우는 것은 관리자만.
    $p$CREATE POLICY "menu_photos_write_admin" ON storage.objects
         FOR INSERT TO authenticated
         WITH CHECK (bucket_id = 'menu-photos' AND public.is_scorecard_admin())$p$,
    $p$CREATE POLICY "menu_photos_update_admin" ON storage.objects
         FOR UPDATE TO authenticated
         USING (bucket_id = 'menu-photos' AND public.is_scorecard_admin())
         WITH CHECK (bucket_id = 'menu-photos' AND public.is_scorecard_admin())$p$,
    $p$CREATE POLICY "menu_photos_delete_admin" ON storage.objects
         FOR DELETE TO authenticated
         USING (bucket_id = 'menu-photos' AND public.is_scorecard_admin())$p$
  ];
  names text[] := ARRAY[
    'menu_photos_read_all', 'menu_photos_write_admin',
    'menu_photos_update_admin', 'menu_photos_delete_admin'
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(wanted, 1) LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', names[i]);
      EXECUTE wanted[i];
      made := made + 1;
    EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
      NULL;  -- 아래에서 한 번만 안내합니다.
    END;
  END LOOP;

  IF made = array_length(wanted, 1) THEN
    RAISE NOTICE '사진 정책 %개를 만들었습니다. 0015 는 여기까지입니다.', made;
  ELSE
    RAISE NOTICE '사진 정책을 만들 권한이 없습니다(% / %). storage.objects 는 supabase_storage_admin 것입니다.',
      made, array_length(wanted, 1);
    RAISE NOTICE '대시보드 > Storage > menu-photos > Policies 에서 네 개를 손으로 넣으세요 - 이 파일 아래 주석에 그대로 있습니다.';
    RAISE NOTICE '**image_url 칸은 이미 들어갔습니다.** 정책이 없으면 /admin 에서 사진 올리기만 안 되고, 메뉴판에서 잘라 온 사진 17장은 앱에 들어 있어 그대로 나옵니다.';
  END IF;
END
$policies$;

-- ----------------------------------------------------------------------------
-- 손으로 넣어야 할 때의 정책 네 개 (대시보드 > Storage > menu-photos > Policies)
-- ----------------------------------------------------------------------------
--  1) menu_photos_read_all    SELECT / anon, authenticated
--       bucket_id = 'menu-photos'
--  2) menu_photos_write_admin INSERT / authenticated
--       bucket_id = 'menu-photos' AND public.is_scorecard_admin()
--  3) menu_photos_update_admin UPDATE / authenticated   (USING 과 WITH CHECK 둘 다)
--       bucket_id = 'menu-photos' AND public.is_scorecard_admin()
--  4) menu_photos_delete_admin DELETE / authenticated
--       bucket_id = 'menu-photos' AND public.is_scorecard_admin()
