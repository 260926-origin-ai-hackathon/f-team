-- Postgres extensions for the care-support redesign (not agents, not tools).
create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgroonga with schema extensions;
