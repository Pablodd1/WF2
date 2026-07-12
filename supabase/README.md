# Supabase migrations

The `migrations` directory is the source of truth for schema changes that must
work in data-less Supabase Preview branches. New migrations must be additive,
timestamped, and committed with the application change that depends on them.

The baseline migration creates the real production `watch_records` contract
without altering existing rows. It exists because the legacy production table
was created outside the repository, while a later image migration assumes that
the table already exists.
