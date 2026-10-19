-- "Other": a category for anything the launch categories do not name. The
-- requester describes the kind of task in a short label, which is shown in
-- place of the category name and screened like the rest of the task text.
ALTER TABLE "tasks" ADD COLUMN "custom_category_label" TEXT;

INSERT INTO "categories" ("id", "slug", "name", "description", "icon", "default_proof_requirements",
  "suggested_min_paise", "suggested_max_paise", "is_active", "location_mode")
VALUES (
  gen_random_uuid()::text,
  'other',
  'Other',
  'Something else at one place. Describe it in your own words.',
  'sparkles',
  '[{"type":"PHOTO","label":"Photo showing the task done","required":true},{"type":"NOTE","label":"What you did","required":true}]'::jsonb,
  10000,
  100000,
  true,
  'SINGLE'
)
ON CONFLICT ("slug") DO NOTHING;
