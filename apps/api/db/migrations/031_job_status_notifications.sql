BEGIN;

CREATE OR REPLACE FUNCTION subil_emit_job_status_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_name text;
  event_title text;
  event_body text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  event_name := CASE NEW.status
    WHEN 'scheduled' THEN 'service.scheduled'
    WHEN 'en_route' THEN 'technician.en_route'
    WHEN 'arrived' THEN 'technician.arrived'
    WHEN 'completed' THEN 'service.completed'
    ELSE NULL
  END;

  IF event_name IS NULL THEN
    RETURN NEW;
  END IF;

  event_title := CASE NEW.status
    WHEN 'scheduled' THEN 'تم تحديد موعد خدمتك'
    WHEN 'en_route' THEN 'الفني في الطريق إليك'
    WHEN 'arrived' THEN 'وصل الفني إلى موقع الخدمة'
    WHEN 'completed' THEN 'تم إكمال خدمتك'
  END;

  event_body := CASE NEW.status
    WHEN 'scheduled' THEN 'تم جدولة طلب الخدمة بنجاح.'
    WHEN 'en_route' THEN 'الفني متجه الآن إلى موقعك.'
    WHEN 'arrived' THEN 'الفني وصل إلى موقع الخدمة.'
    WHEN 'completed' THEN 'اكتملت الخدمة. يمكنك الآن تقييم تجربتك.'
  END;

  INSERT INTO notification_events (event_type, customer_id, job_id, channels, payload)
  VALUES (
    event_name,
    NEW.customer_id,
    NEW.id,
    ARRAY['push','whatsapp','sms']::text[],
    jsonb_build_object(
      'title', event_title,
      'body', event_body,
      'url', '/jobs/' || NEW.id::text,
      'status', NEW.status,
      'scheduledAt', NEW.scheduled_at,
      'ratingRequested', NEW.status = 'completed'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_jobs_status_notification_trg ON service_jobs;
CREATE TRIGGER service_jobs_status_notification_trg
AFTER INSERT OR UPDATE OF status ON service_jobs
FOR EACH ROW
EXECUTE FUNCTION subil_emit_job_status_notification();

COMMIT;
