-- Pacotes cortesia (counter): gestor envia 1 link; destinatário distribui ingressos individuais.

CREATE TABLE IF NOT EXISTS public.complimentary_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.event_batches(id) ON DELETE RESTRICT,
  manager_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 50),
  public_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  holder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  holder_claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'cancelled', 'fully_redeemed')),
  notes TEXT,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.complimentary_bundle_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES public.complimentary_bundles(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL CHECK (seat_number > 0),
  redeem_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  redeemed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  wristband_analytics_id UUID REFERENCES public.wristband_analytics(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'redeemed', 'cancelled')),
  UNIQUE (bundle_id, seat_number)
);

CREATE INDEX IF NOT EXISTS idx_complimentary_bundles_event_id
  ON public.complimentary_bundles(event_id);
CREATE INDEX IF NOT EXISTS idx_complimentary_bundles_public_token
  ON public.complimentary_bundles(public_token);
CREATE INDEX IF NOT EXISTS idx_complimentary_bundle_seats_bundle_id
  ON public.complimentary_bundle_seats(bundle_id);
CREATE INDEX IF NOT EXISTS idx_complimentary_bundle_seats_redeem_token
  ON public.complimentary_bundle_seats(redeem_token);

ALTER TABLE public.complimentary_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complimentary_bundle_seats ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.complimentary_bundles IS
  'Pacote cortesia counter: um link para o destinatário distribuir N ingressos de lote gratuito.';
COMMENT ON TABLE public.complimentary_bundle_seats IS
  'Assento individual do pacote cortesia; cada um possui link de resgate único.';

CREATE OR REPLACE FUNCTION public._complimentary_bundle_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complimentary_bundles_updated_at ON public.complimentary_bundles;
CREATE TRIGGER trg_complimentary_bundles_updated_at
  BEFORE UPDATE ON public.complimentary_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public._complimentary_bundle_touch_updated_at();

CREATE OR REPLACE FUNCTION public._complimentary_release_unredeemed_reserved(p_bundle_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_unredeemed INTEGER;
BEGIN
  SELECT cb.batch_id
  INTO v_batch_id
  FROM public.complimentary_bundles cb
  WHERE cb.id = p_bundle_id;

  IF v_batch_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_unredeemed
  FROM public.complimentary_bundle_seats s
  WHERE s.bundle_id = p_bundle_id
    AND s.status = 'available';

  IF v_unredeemed <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.batch_inventory bi
  SET
    reserved = GREATEST(bi.reserved - v_unredeemed, 0),
    updated_at = timezone('utc'::text, now())
  WHERE bi.batch_id = v_batch_id;

  UPDATE public.complimentary_bundle_seats s
  SET status = 'cancelled'
  WHERE s.bundle_id = p_bundle_id
    AND s.status = 'available';

  RETURN v_unredeemed;
END;
$$;

CREATE OR REPLACE FUNCTION public._complimentary_expire_bundle_if_needed(p_bundle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
BEGIN
  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = p_bundle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_bundle.status IN ('cancelled', 'fully_redeemed', 'expired') THEN
    RETURN;
  END IF;

  IF v_bundle.expires_at < timezone('utc'::text, now()) THEN
    PERFORM public._complimentary_release_unredeemed_reserved(p_bundle_id);
    UPDATE public.complimentary_bundles
    SET status = 'expired'
    WHERE id = p_bundle_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._complimentary_materialize_seat_ticket(
  p_batch_id UUID,
  p_client_user_id UUID,
  p_bundle_id UUID,
  p_seat_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.event_batches%ROWTYPE;
  v_wristband public.wristbands%ROWTYPE;
  v_seq INTEGER;
  v_code TEXT;
  v_new_id UUID;
  v_rows INTEGER;
BEGIN
  SELECT * INTO v_batch
  FROM public.event_batches eb
  WHERE eb.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote não encontrado.';
  END IF;

  IF COALESCE(v_batch.price, 0) <> 0 THEN
    RAISE EXCEPTION 'Pacote cortesia só pode usar lotes gratuitos.';
  END IF;

  UPDATE public.batch_inventory bi
  SET
    reserved = bi.reserved - 1,
    sold = bi.sold + 1,
    updated_at = timezone('utc'::text, now())
  WHERE bi.batch_id = p_batch_id
    AND bi.reserved >= 1
    AND (bi.total - bi.sold - bi.reserved) >= 0;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Estoque cortesia indisponível para este lote.';
  END IF;

  IF v_batch.wristband_id IS NULL THEN
    RAISE EXCEPTION 'Pulseira-template do lote não configurada.';
  END IF;

  SELECT * INTO v_wristband
  FROM public.wristbands w
  WHERE w.id = v_batch.wristband_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pulseira-template do lote não encontrada.';
  END IF;

  SELECT COALESCE(MAX(wa.sequential_number), 0)
  INTO v_seq
  FROM public.wristband_analytics wa
  WHERE wa.wristband_id = v_batch.wristband_id;

  v_seq := v_seq + 1;
  v_code := v_wristband.code || '-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.wristband_analytics (
    wristband_id,
    event_type,
    client_user_id,
    code_wristbands,
    status,
    sequential_number,
    event_data
  ) VALUES (
    v_batch.wristband_id,
    'complimentary_redemption',
    p_client_user_id,
    v_code,
    'active',
    v_seq,
    jsonb_build_object(
      'code', v_code,
      'access_type', v_wristband.access_type,
      'price', v_wristband.price,
      'event_id', v_wristband.event_id,
      'batch_id', p_batch_id,
      'complimentary_bundle_id', p_bundle_id,
      'complimentary_seat_id', p_seat_id,
      'materialized_at', timezone('utc'::text, now())
    )
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'analytics_id', v_new_id,
    'code_wristbands', v_code,
    'access_type', v_wristband.access_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_complimentary_bundle(
  p_event_id UUID,
  p_batch_id UUID,
  p_recipient_name TEXT,
  p_recipient_email TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT 1,
  p_expires_days INTEGER DEFAULT 30,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_batch public.event_batches%ROWTYPE;
  v_available INTEGER;
  v_bundle_id UUID;
  v_public_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_email TEXT;
  v_name TEXT;
  v_i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.user_can_manage_event(p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_name := trim(COALESCE(p_recipient_name, ''));
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipient_name_required');
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;

  IF COALESCE(v_event.inventory_mode, 'unit_rows') <> 'counter' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'counter_only');
  END IF;

  SELECT * INTO v_batch
  FROM public.event_batches eb
  WHERE eb.id = p_batch_id
    AND eb.event_id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_not_found');
  END IF;

  IF COALESCE(v_batch.price, 0) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'batch_must_be_free');
  END IF;

  v_available := public.batch_inventory_available(p_batch_id);
  IF v_available < p_quantity THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient_stock',
      'available', v_available
    );
  END IF;

  v_email := NULLIF(lower(trim(COALESCE(p_recipient_email, ''))), '');
  v_expires_at := timezone('utc'::text, now())
    + make_interval(days => GREATEST(COALESCE(p_expires_days, 30), 1));

  UPDATE public.batch_inventory bi
  SET
    reserved = bi.reserved + p_quantity,
    updated_at = timezone('utc'::text, now())
  WHERE bi.batch_id = p_batch_id
    AND (bi.total - bi.sold - bi.reserved) >= p_quantity;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reserve_failed');
  END IF;

  INSERT INTO public.complimentary_bundles (
    event_id,
    batch_id,
    manager_user_id,
    recipient_name,
    recipient_email,
    quantity,
    expires_at,
    notes
  ) VALUES (
    p_event_id,
    p_batch_id,
    auth.uid(),
    v_name,
    v_email,
    p_quantity,
    v_expires_at,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id, public_token INTO v_bundle_id, v_public_token;

  FOR v_i IN 1 .. p_quantity LOOP
    INSERT INTO public.complimentary_bundle_seats (bundle_id, seat_number)
    VALUES (v_bundle_id, v_i);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_id', v_bundle_id,
    'public_token', v_public_token,
    'recipient_name', v_name,
    'recipient_email', v_email,
    'quantity', p_quantity,
    'batch_name', v_batch.name,
    'event_title', v_event.title,
    'expires_at', v_expires_at
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unexpected', 'detail', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_complimentary_bundles(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.user_can_manage_event(p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bundles', COALESCE(
      (
        SELECT jsonb_agg(row_payload ORDER BY created_at DESC)
        FROM (
          SELECT jsonb_build_object(
            'id', cb.id,
            'recipient_name', cb.recipient_name,
            'recipient_email', cb.recipient_email,
            'quantity', cb.quantity,
            'public_token', cb.public_token,
            'status', cb.status,
            'expires_at', cb.expires_at,
            'created_at', cb.created_at,
            'batch_name', eb.name,
            'redeemed_count', (
              SELECT COUNT(*)::INTEGER
              FROM public.complimentary_bundle_seats s
              WHERE s.bundle_id = cb.id
                AND s.status = 'redeemed'
            ),
            'available_count', (
              SELECT COUNT(*)::INTEGER
              FROM public.complimentary_bundle_seats s
              WHERE s.bundle_id = cb.id
                AND s.status = 'available'
            ),
            'holder_claimed', cb.holder_user_id IS NOT NULL,
            'email_sent_at', cb.email_sent_at
          ) AS row_payload,
          cb.created_at
          FROM public.complimentary_bundles cb
          INNER JOIN public.event_batches eb ON eb.id = cb.batch_id
          WHERE cb.event_id = p_event_id
        ) sub
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_complimentary_bundle(p_bundle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = p_bundle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF NOT public.user_can_manage_event(v_bundle.event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_bundle.status IN ('cancelled', 'fully_redeemed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  PERFORM public._complimentary_release_unredeemed_reserved(p_bundle_id);

  UPDATE public.complimentary_bundles
  SET status = 'cancelled'
  WHERE id = p_bundle_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_complimentary_bundle_public(p_public_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_batch public.event_batches%ROWTYPE;
  v_redeemed INTEGER;
  v_available INTEGER;
  v_is_holder BOOLEAN := false;
BEGIN
  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.public_token = NULLIF(trim(p_public_token), '');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  PERFORM public._complimentary_expire_bundle_if_needed(v_bundle.id);

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_bundle.id;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_bundle.event_id;
  SELECT * INTO v_batch FROM public.event_batches eb WHERE eb.id = v_bundle.batch_id;

  SELECT COUNT(*)::INTEGER
  INTO v_redeemed
  FROM public.complimentary_bundle_seats s
  WHERE s.bundle_id = v_bundle.id
    AND s.status = 'redeemed';

  SELECT COUNT(*)::INTEGER
  INTO v_available
  FROM public.complimentary_bundle_seats s
  WHERE s.bundle_id = v_bundle.id
    AND s.status = 'available';

  IF auth.uid() IS NOT NULL AND v_bundle.holder_user_id = auth.uid() THEN
    v_is_holder := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_id', v_bundle.id,
    'public_token', v_bundle.public_token,
    'status', v_bundle.status,
    'recipient_name', v_bundle.recipient_name,
    'quantity', v_bundle.quantity,
    'redeemed_count', v_redeemed,
    'available_count', v_available,
    'expires_at', v_bundle.expires_at,
    'holder_claimed', v_bundle.holder_user_id IS NOT NULL,
    'is_holder', v_is_holder,
    'batch_name', v_batch.name,
    'event_id', v_event.id,
    'event_title', v_event.title,
    'event_date', v_event.date,
    'event_location', v_event.location,
    'requires_login', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_complimentary_bundle_holder(p_public_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_user_email TEXT;
  v_recipient_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.public_token = NULLIF(trim(p_public_token), '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  PERFORM public._complimentary_expire_bundle_if_needed(v_bundle.id);

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_bundle.id;

  IF v_bundle.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle_not_active', 'status', v_bundle.status);
  END IF;

  v_user_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
  v_recipient_email := lower(trim(COALESCE(v_bundle.recipient_email, '')));

  IF v_recipient_email <> '' AND v_user_email <> v_recipient_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch');
  END IF;

  IF v_bundle.holder_user_id IS NOT NULL AND v_bundle.holder_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'holder_already_claimed');
  END IF;

  IF v_bundle.holder_user_id IS NULL THEN
    UPDATE public.complimentary_bundles
    SET
      holder_user_id = auth.uid(),
      holder_claimed_at = timezone('utc'::text, now())
    WHERE id = v_bundle.id;
  END IF;

  RETURN public.get_complimentary_bundle_holder_view(p_public_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_complimentary_bundle_holder_view(p_public_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_batch public.event_batches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.public_token = NULLIF(trim(p_public_token), '');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  PERFORM public._complimentary_expire_bundle_if_needed(v_bundle.id);

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_bundle.id;

  IF v_bundle.holder_user_id IS DISTINCT FROM auth.uid()
     AND NOT public.user_can_manage_event(v_bundle.event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_bundle.event_id;
  SELECT * INTO v_batch FROM public.event_batches eb WHERE eb.id = v_bundle.batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_id', v_bundle.id,
    'public_token', v_bundle.public_token,
    'status', v_bundle.status,
    'recipient_name', v_bundle.recipient_name,
    'quantity', v_bundle.quantity,
    'batch_name', v_batch.name,
    'event_title', v_event.title,
    'event_date', v_event.date,
    'expires_at', v_bundle.expires_at,
    'seats', COALESCE(
      (
        SELECT jsonb_agg(row_payload ORDER BY seat_number ASC)
        FROM (
          SELECT jsonb_build_object(
            'seat_number', s.seat_number,
            'status', s.status,
            'redeem_token', s.redeem_token,
            'redeemed_at', s.redeemed_at
          ) AS row_payload,
          s.seat_number
          FROM public.complimentary_bundle_seats s
          WHERE s.bundle_id = v_bundle.id
        ) sub
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_complimentary_seat_public(p_redeem_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat public.complimentary_bundle_seats%ROWTYPE;
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_batch public.event_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_seat
  FROM public.complimentary_bundle_seats s
  WHERE s.redeem_token = NULLIF(trim(p_redeem_token), '');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_seat.bundle_id;

  PERFORM public._complimentary_expire_bundle_if_needed(v_bundle.id);

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_bundle.id;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_bundle.event_id;
  SELECT * INTO v_batch FROM public.event_batches eb WHERE eb.id = v_bundle.batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'seat_number', v_seat.seat_number,
    'seat_status', v_seat.status,
    'bundle_status', v_bundle.status,
    'batch_name', v_batch.name,
    'event_id', v_event.id,
    'event_title', v_event.title,
    'event_date', v_event.date,
    'event_location', v_event.location,
    'expires_at', v_bundle.expires_at,
    'already_redeemed', v_seat.status = 'redeemed',
    'requires_login', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_complimentary_seat(p_redeem_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat public.complimentary_bundle_seats%ROWTYPE;
  v_bundle public.complimentary_bundles%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_ticket JSONB;
  v_remaining INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_seat
  FROM public.complimentary_bundle_seats s
  WHERE s.redeem_token = NULLIF(trim(p_redeem_token), '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_seat.status = 'redeemed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;

  IF v_seat.status <> 'available' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_not_available');
  END IF;

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_seat.bundle_id
  FOR UPDATE;

  PERFORM public._complimentary_expire_bundle_if_needed(v_bundle.id);

  SELECT * INTO v_bundle
  FROM public.complimentary_bundles cb
  WHERE cb.id = v_bundle.id;

  IF v_bundle.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle_not_active', 'status', v_bundle.status);
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_bundle.event_id;

  v_ticket := public._complimentary_materialize_seat_ticket(
    v_bundle.batch_id,
    auth.uid(),
    v_bundle.id,
    v_seat.id
  );

  UPDATE public.complimentary_bundle_seats
  SET
    status = 'redeemed',
    redeemed_by_user_id = auth.uid(),
    redeemed_at = timezone('utc'::text, now()),
    wristband_analytics_id = NULLIF(v_ticket->>'analytics_id', '')::uuid
  WHERE id = v_seat.id;

  SELECT COUNT(*)::INTEGER
  INTO v_remaining
  FROM public.complimentary_bundle_seats s
  WHERE s.bundle_id = v_bundle.id
    AND s.status = 'available';

  IF v_remaining = 0 THEN
    UPDATE public.complimentary_bundles
    SET status = 'fully_redeemed'
    WHERE id = v_bundle.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'analytics_id', v_ticket->>'analytics_id',
    'code_wristbands', v_ticket->>'code_wristbands',
    'access_type', v_ticket->>'access_type',
    'event_id', v_event.id,
    'event_title', v_event.title,
    'event_date', v_event.date,
    'event_location', v_event.location,
    'batch_name', (
      SELECT eb.name FROM public.event_batches eb WHERE eb.id = v_bundle.batch_id
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unexpected', 'detail', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_complimentary_bundle_email_sent(p_bundle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.complimentary_bundles
  SET email_sent_at = timezone('utc'::text, now())
  WHERE id = p_bundle_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_complimentary_bundle(UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_complimentary_bundles(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_complimentary_bundle(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_complimentary_bundle_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_complimentary_bundle_holder(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_complimentary_bundle_holder_view(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_complimentary_seat_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_complimentary_seat(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_complimentary_bundle_email_sent(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_complimentary_bundle(UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_complimentary_bundles(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_complimentary_bundle(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_complimentary_bundle_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_complimentary_bundle_holder(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_complimentary_bundle_holder_view(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_complimentary_seat_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_complimentary_seat(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_complimentary_bundle_email_sent(UUID) TO service_role;

COMMENT ON FUNCTION public.create_complimentary_bundle IS
  'Gestor cria pacote cortesia counter; reserva estoque e gera assentos com links individuais.';
COMMENT ON FUNCTION public.redeem_complimentary_seat IS
  'Cliente autenticado resgata 1 ingresso cortesia via link individual; materializa wristband_analytics.';
