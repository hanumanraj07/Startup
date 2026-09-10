-- Creates the application database.
--
-- Runs after the postgis image's own 10_postgis.sh, which installs postgis,
-- postgis_topology, fuzzystrmatch and postgis_tiger_geocoder into the database
-- named by POSTGRES_DB. Prisma reports any extension it did not create itself
-- as schema drift and refuses to migrate, so the application gets its own
-- database built from template0, which carries no extensions at all.
--
-- Prisma then creates and owns exactly one extension, postgis, through the
-- initial migration. That is also what we want in production, where the other
-- three have no purpose.
--
-- Only runs on a fresh volume. On an existing volume, create it by hand:
--   docker exec onsite-db psql -U onsite -d onsite \
--     -c "CREATE DATABASE onsite_app TEMPLATE template0 OWNER onsite;"

CREATE DATABASE onsite_app TEMPLATE template0 OWNER onsite;
