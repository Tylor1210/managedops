-- Adds an optional SOP to each recurring job: a free-text description of
-- what needs to be done, and an ordered checklist of steps for how to do it.
-- Both are authored by an admin and are optional -- a job works fine with
-- neither filled in.

ALTER TABLE managed_ops ADD COLUMN description TEXT;
ALTER TABLE managed_ops ADD COLUMN steps TEXT NOT NULL DEFAULT '[]';

UPDATE managed_ops
SET description = 'Refresh the client''s public business profile so hours, contact info, and photos are current.',
    steps = '["Log into the client''s Google Business Profile","Verify hours, phone number, and address are correct","Upload any new photos provided by the client","Reply to new reviews if any are outstanding"]'
WHERE task_type = 'Client Profile Refresh';

UPDATE managed_ops
SET description = 'Keep the client''s social listing pages consistent across platforms.',
    steps = '["Compare listing details across Facebook, Instagram, and Google","Update any mismatched hours or contact info","Confirm the latest promo or announcement is pinned"]'
WHERE task_type = 'Social Listing Sync';
