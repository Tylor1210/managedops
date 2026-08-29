-- Priority levels for recurring jobs. 'urgent' gets a blinking red outline
-- treatment on cards so it's impossible to miss on the board.
ALTER TABLE managed_ops ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'high', 'urgent'));
