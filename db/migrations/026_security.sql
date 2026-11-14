-- Review group C: hardening before the company server.
-- C2: a session belongs to one "version" of the user's sign-in; changing the password, an admin reset or
-- "sign out" moves the version on, so every older session stops working at once.
ALTER TABLE app_user ADD COLUMN session_version int NOT NULL DEFAULT 0;
-- C3: the session signing key no longer lives in the database (it was copied into every backup).
DELETE FROM setting WHERE key='session_secret';
