begin;

create function public.validate_production_inputs() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  item jsonb;
  ingredient uuid;
  seen uuid[] := '{}';
begin
  if new.event_type <> 'production' then return new; end if;
  if new.payload ? 'baking_cost' then
    perform event_integer(new.payload, 'baking_cost', 0, 1000000000);
  end if;
  if not (new.payload ? 'inputs') then return new; end if;
  if jsonb_typeof(new.payload->'inputs') <> 'array' then
    raise exception 'Invalid bake ingredients.';
  end if;
  if jsonb_array_length(new.payload->'inputs') not between 1 and 30 then
    raise exception 'Enter between 1 and 30 bake ingredients.';
  end if;
  for item in select value from jsonb_array_elements(new.payload->'inputs') loop
    ingredient := (item->>'ingredient_id')::uuid;
    if ingredient is null or ingredient = any(seen) or not exists (
      select 1 from ingredients where id = ingredient and bakery_id = new.bakery_id
    ) then
      raise exception 'Choose each ingredient from this bakery once.';
    end if;
    perform event_integer(item, 'quantity', 1, 1000000);
    seen := array_append(seen, ingredient);
  end loop;
  return new;
end;
$$;

create trigger validate_production_inputs
before insert on public.sync_events
for each row execute function public.validate_production_inputs();

commit;
