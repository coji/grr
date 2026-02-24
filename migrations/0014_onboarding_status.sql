-- Add onboarding status to track user's onboarding progress
-- 'none': Not yet contacted (default for existing users with diaryChannelId)
-- 'welcomed': Welcome message sent, waiting for user's response
-- 'completed': Onboarding complete, character created

ALTER TABLE user_diary_settings
ADD COLUMN onboarding_status TEXT DEFAULT 'none';

-- For existing users who already have a diary channel set,
-- mark them as completed (they've already been using the app)
UPDATE user_diary_settings
SET onboarding_status = 'completed'
WHERE diary_channel_id IS NOT NULL;
