-- The response standard moved from two envelopes (success and error) to one
-- envelope whose `$slots` an endpoint author fills per response. Rows written
-- before that change carry `successEnvelope`/`errorEnvelope`; this folds the
-- success envelope into `envelope` and renames `$payload` to `$data`.
--
-- The error envelope is dropped rather than merged: the two shapes cannot be
-- combined mechanically, and the success envelope is the one every response
-- now wears.
UPDATE "response_standards"
SET "definition" =
  ("definition" - 'successEnvelope' - 'errorEnvelope')
  || jsonb_build_object(
       'envelope',
       replace(
         ("definition" -> 'successEnvelope')::text,
         '"$payload"',
         '"$data"'
       )::jsonb
     )
WHERE "definition" ? 'successEnvelope';
