-- A service account authorises nothing through a client, so its grant names none.
--
-- Migration 0049 made `client_id` mandatory on every grant, which was right for the only actor it
-- had thought through: a person approving a registered client in a browser. A service account has
-- no browser and no client. It presents a secret and is itself the whole story, so the column it
-- was being asked to fill would have had to be filled with a lie -- some placeholder client row
-- that nobody registered and that the consent screen would then have to explain.
--
-- The constraint that replaces the `not null` says exactly that: a user grant always names the
-- client that asked, and a service account grant never does. That is stricter than what it
-- replaces, not looser -- before, a service account grant could have carried any client at all.
--
-- Existing rows are untouched: every grant written so far is a user grant with a client, which the
-- new constraint already accepts.

alter table mcp_grants alter column client_id drop not null;

alter table mcp_grants
  add constraint mcp_grants_client_matches_actor
  check ((actor_type = 'user') = (client_id is not null));
