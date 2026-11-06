-- Business rules that Prisma's schema language cannot express.

-- A review is always a 1..5 star rating.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- A version code is a positive integer.
ALTER TABLE "app_versions"
  ADD CONSTRAINT "app_versions_version_code_positive" CHECK ("version_code" > 0);

-- Files must have a positive size.
ALTER TABLE "app_files"
  ADD CONSTRAINT "app_files_size_positive" CHECK ("size" > 0);

-- Download events always point at a real version of the same app.
CREATE OR REPLACE FUNCTION assert_download_event_app() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "app_versions" v WHERE v."id" = NEW."version_id" AND v."app_id" = NEW."app_id"
  ) THEN
    RAISE EXCEPTION 'download event version does not belong to the app';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "download_events_app_check"
  BEFORE INSERT ON "download_events"
  FOR EACH ROW EXECUTE FUNCTION assert_download_event_app();

-- Audit history is append-only: no updates, no deletes, ever.
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Full-text search index used by GET /api/v1/search.
CREATE INDEX "apps_search_idx" ON "apps" USING GIN (
  to_tsvector(
    'english',
    coalesce("name", '') || ' ' || coalesce("short_description", '') || ' ' ||
    coalesce("full_description", '') || ' ' || "package_name"
  )
);

-- Case-insensitive email lookups are the hottest query in authentication.
CREATE INDEX "users_email_lower_idx" ON "users" (lower("email"));

-- Public catalogue ordering.
CREATE INDEX "apps_published_at_idx" ON "apps" ("published_at" DESC);
