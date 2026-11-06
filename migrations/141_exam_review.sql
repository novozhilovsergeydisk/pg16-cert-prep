-- Снимок завершённого экзамена; старые записи сохраняют только сводку.
BEGIN;
ALTER TABLE exam_history ADD COLUMN IF NOT EXISTS snapshot jsonb;
ALTER TABLE exam_history ADD COLUMN IF NOT EXISTS submission_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS exam_history_submission_idx
    ON exam_history (user_id, submission_id);
COMMIT;
