-- Remove unused character_svg column
-- Character images are now generated as PNG via Gemini Pro Image and stored in R2
ALTER TABLE user_characters DROP COLUMN character_svg;
