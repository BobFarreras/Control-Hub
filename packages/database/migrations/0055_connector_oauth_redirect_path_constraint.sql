-- PostgreSQL bounds regular-expression repetitions at 255. The original `{1,500}` check in
-- 0050 therefore raised `invalid repetition count(s)` whenever an OAuth attempt was inserted.
-- Keep the character allowlist in the regex and enforce the larger bound with char_length.

alter table connector_oauth_attempts
  drop constraint connector_oauth_attempts_redirect_path_check;

alter table connector_oauth_attempts
  add constraint connector_oauth_attempts_redirect_path_check
  check (
    char_length(redirect_path) between 1 and 500
    and redirect_path ~ '^/[A-Za-z0-9/_?=&.-]+$'
  );
