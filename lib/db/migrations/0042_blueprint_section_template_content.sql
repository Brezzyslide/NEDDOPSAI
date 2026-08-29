-- 0042_blueprint_section_template_content.sql
-- Adds authored template-content fields to Blueprint sections.
-- These fields distinguish standing content to emit from participant fields
-- and form-completion prompts.

ALTER TABLE blueprint_sections
  ADD COLUMN IF NOT EXISTS fixed_content JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completion_prompt TEXT;
