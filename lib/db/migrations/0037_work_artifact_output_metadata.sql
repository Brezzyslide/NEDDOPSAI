-- 0037_work_artifact_output_metadata.sql
-- Additive metadata for generated Completed Work artifacts.
--
-- work_artifacts already links generated files to tasks/completed_work. These
-- nullable fields allow runtime completion gates and authenticated download
-- proofs to verify the generated object without overloading evidence assets.

ALTER TABLE work_artifacts
  ADD COLUMN IF NOT EXISTS storage_provider TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size INTEGER,
  ADD COLUMN IF NOT EXISTS checksum TEXT;

COMMENT ON COLUMN work_artifacts.storage_provider IS
  'Storage backend used for the generated artifact, for example s3 or gcs.';
COMMENT ON COLUMN work_artifacts.mime_type IS
  'MIME type of the generated artifact persisted to private object storage.';
COMMENT ON COLUMN work_artifacts.file_size IS
  'Generated artifact size in bytes; must be non-zero for completed artifacts.';
COMMENT ON COLUMN work_artifacts.checksum IS
  'SHA-256 checksum of the generated artifact bytes.';
