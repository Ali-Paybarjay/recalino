-- Direction is content identity; sister cards share a learning item but keep separate schedules.
alter table card.card add column direction text not null default 'forward' check(direction in ('forward','reverse'));
create unique index card_item_direction on card.card(user_id,learning_item_id,direction,template) where deleted_at is null;
