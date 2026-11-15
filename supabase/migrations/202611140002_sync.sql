begin;
-- Cast through numeric to reject fractional JSON numbers instead of rounding them.
create function public.event_integer(p jsonb,k text,minimum bigint,maximum bigint) returns bigint language plpgsql immutable set search_path=public,pg_temp as $$declare n numeric;begin
 if jsonb_typeof(p->k)<>'number' or p->k is null then raise exception 'Enter a whole number for %.',k;end if;
 n:=(p->>k)::numeric;if n<>trunc(n) or n<minimum or n>maximum then raise exception 'Invalid whole number for %.',k;end if;return n::bigint;
end$$;
create function public.push_events(batch jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare me profiles;e jsonb;p jsonb;old sync_events;t text;eid uuid;entity uuid;device uuid;loc uuid;dest uuid;seq bigint;q bigint;price bigint;paid bigint;total_paid bigint;target_sale sales;tr bread_transfers;item jsonb;ing uuid;customer uuid;result jsonb:='[]';prior sync_events;
begin
 select * into me from profiles where user_id=auth.uid();if me.user_id is null then raise exception 'Join a bakery first.';end if;
 if jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)>25 then raise exception 'Send at most 25 records.';end if;
 -- All bakery writers acquire this lock BEFORE assigning sequences. Pull takes the same lock,
 -- preventing a committed high sequence from hiding an earlier uncommitted event.
 perform pg_advisory_xact_lock(hashtextextended(me.bakery_id::text,0));
 select * into me from profiles where user_id=auth.uid();
 for e in select value from jsonb_array_elements(batch) loop
 begin
 eid:=(e->>'event_id')::uuid;entity:=(e->>'entity_id')::uuid;device:=(e->>'device_id')::uuid;t:=e->>'event_type';p:=e->'payload';loc:=me.location_id;
 if eid is null or entity is null or device is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>16000 or (e->>'schema_version')::integer is distinct from 1 then raise exception 'Invalid record format.';end if;
 select * into old from sync_events where event_id=eid;
 if old.event_id is not null then
 if old.user_id<>me.user_id or old.bakery_id<>me.bakery_id or old.entity_id<>entity or old.device_id<>device or old.event_type<>t or old.payload<>p or old.effective_at<>(e->>'effective_at')::timestamptz or old.client_created_at<>(e->>'client_created_at')::timestamptz then raise exception 'Record ID already belongs to a different record.';end if;
 result:=result||jsonb_build_array(jsonb_build_object('event_id',eid,'accepted',true,'server_seq',old.server_seq));continue;end if;
 if exists(select 1 from devices where id=device and (user_id<>me.user_id or bakery_id<>me.bakery_id or revoked)) then raise exception 'Device access was revoked or belongs to another user.';end if;
 insert into devices(id,bakery_id,user_id) values(device,me.bakery_id,me.user_id) on conflict(id) do update set last_seen=now();
 if t='bread_adjustment' and me.role in ('owner','manager') and p->>'location_id' is not null then
 select id into loc from stock_locations where id=(p->>'location_id')::uuid and bakery_id=me.bakery_id;
 if loc is null then raise exception 'Choose a stock location in this bakery.';end if;end if;
 if e->>'location_id' is not null and (e->>'location_id')::uuid<>loc then raise exception 'Your stock location changed. Ask the owner to review this pending record.';end if;
 if (select count(*) from sync_events where user_id=me.user_id and received_at>now()-interval '1 hour')>=2000 then raise exception 'Too many records this hour. Try backup later.';end if;
 if me.role='seller' and t not in ('sale','payment','receipt','return','bread_count','damage') then raise exception 'Your current role cannot perform this action.';end if;
 if t not in ('production','transfer','receipt','return','sale','payment','bread_count','damage','bread_adjustment','purchase','ingredient_count','ingredient_adjustment','expense','reversal') then raise exception 'Unknown record type.';end if;
 if (e->>'effective_at')::timestamptz>now()+interval '1 day' or (e->>'effective_at')::timestamptz<'2020-01-01' then raise exception 'Check the record date and device clock.';end if;
 if (e->>'effective_at') is null or (e->>'client_created_at') is null then raise exception 'Record timestamps are required.';end if;
 if length(coalesce(p->>'notes',''))>500 then raise exception 'Notes are too long.';end if;
 -- Entity IDs, user, bakery, location and financial totals are server controlled/validated.
 insert into sync_events(event_id,entity_id,device_id,user_id,bakery_id,location_id,event_type,schema_version,payload,client_created_at,effective_at) values(eid,entity,device,me.user_id,me.bakery_id,loc,t,1,p,(e->>'client_created_at')::timestamptz,(e->>'effective_at')::timestamptz) returning server_seq into seq;
 if t in ('production','transfer','return','sale','damage') then q:=event_integer(p,'quantity',1,1000000);end if;
 case t
 when 'production' then insert into production_batches values(entity,me.bakery_id,eid,q);
 when 'transfer','return' then
 if t='return' then
 if me.role<>'seller' then raise exception 'Only sellers initiate returns.';end if;
 select id into dest from stock_locations where bakery_id=me.bakery_id and kind='bakery';
 -- Add server-derived destination to the canonical event for seller/manager visibility.
 -- Return destination is derived from the bakery; payload remains immutable for retries.
 else dest:=(p->>'destination')::uuid;if not exists(select 1 from stock_locations where id=dest and bakery_id=me.bakery_id and kind='seller') then raise exception 'Choose a seller in this bakery.';end if;end if;
 insert into bread_transfers(id,bakery_id,event_id,reference,source,destination,quantity_sent) values(entity,me.bakery_id,eid,'BR-'||seq,loc,dest,q);
 when 'receipt' then
 select * into tr from bread_transfers where id=(p->>'transfer_id')::uuid and bakery_id=me.bakery_id for update;
 if tr.id is null or tr.destination<>loc or tr.status<>'pending' then raise exception 'Transfer is unavailable or already confirmed.';end if;
 if exists(select 1 from sync_events where bakery_id=me.bakery_id and event_type='reversal' and payload->>'event_id'=tr.event_id::text) then raise exception 'Transfer was reversed.';end if;
 q:=event_integer(p,'quantity',0,1000000);
 insert into transfer_confirmations values(entity,me.bakery_id,eid,tr.id,q);
 update bread_transfers set quantity_received=q,status=case when q=quantity_sent then 'confirmed' else 'disputed' end where id=tr.id;
 if q<>tr.quantity_sent then insert into sync_conflicts(bakery_id,event_id,reason) values(me.bakery_id,eid,'Sent and received quantities differ. Both observations retained.');end if;
 when 'sale' then
 price:=event_integer(p,'unit_price',0,1000000000);paid:=event_integer(p,'amount_received',0,1000000000);
 if q*price>1000000000 or paid>q*price or p->>'kind' not in ('retail','wholesale') or coalesce(p->>'method','') not in ('cash','mobile_money','credit') or (p->>'method'='credit' and paid<>0) then raise exception 'Invalid sale or payment.';end if;
 customer:=null;
 if length(trim(coalesce(p->>'customer','')))>0 then
 if length(p->>'customer')>120 then raise exception 'Customer name too long.';end if;
 insert into customers(bakery_id,name) values(me.bakery_id,trim(p->>'customer')) on conflict(bakery_id,name) do update set name=excluded.name returning id into customer;end if;
 if paid<q*price and customer is null then raise exception 'Customer name is required for credit.';end if;
 insert into sales(id,bakery_id,event_id,location_id,seller_id,customer_id,quantity,unit_price,kind) values(entity,me.bakery_id,eid,loc,me.user_id,customer,q,price,p->>'kind');
 if paid>0 then insert into payments(id,bakery_id,event_id,sale_id,amount,method) values(gen_random_uuid(),me.bakery_id,eid,entity,paid,p->>'method');end if;
 when 'payment' then
 select * into target_sale from sales where id=(p->>'sale_id')::uuid and bakery_id=me.bakery_id for update;
 if target_sale.id is null or target_sale.voided or (me.role='seller' and target_sale.seller_id<>me.user_id) then raise exception 'Sale unavailable.';end if;
 paid:=event_integer(p,'amount',1,1000000000);
 select coalesce(sum(pay.amount),0) into total_paid from payments pay where pay.sale_id=target_sale.id and not exists(select 1 from sync_events r where r.bakery_id=me.bakery_id and r.event_type='reversal' and r.payload->>'event_id'=pay.event_id::text);
 if total_paid+paid>target_sale.total or p->>'method' not in ('cash','mobile_money') then raise exception 'Payment exceeds the remaining debt or uses an invalid method.';end if;
 insert into payments(id,bakery_id,event_id,sale_id,amount,method) values(entity,me.bakery_id,eid,target_sale.id,paid,p->>'method');
 when 'bread_count' then
 q:=event_integer(p,'quantity',0,1000000);insert into bread_stock_counts values(entity,me.bakery_id,eid,loc,q);
 insert into sync_conflicts(bakery_id,event_id,reason) values(me.bakery_id,eid,'Physical count is an observation. Compare with ledger; do not replace stock.');
 when 'damage' then insert into bread_adjustments values(entity,me.bakery_id,eid,loc,-q,'Damaged bread');
 when 'bread_adjustment' then
 q:=event_integer(p,'quantity',-1000000,1000000);if q=0 or length(trim(coalesce(p->>'notes','')))<3 then raise exception 'Give a quantity and reason.';end if;
 insert into bread_adjustments values(entity,me.bakery_id,eid,loc,q,p->>'notes');
 when 'purchase' then
 if jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items') not between 1 and 30 then raise exception 'Enter purchase items.';end if;
 insert into purchase_batches values(entity,me.bakery_id,eid,p->>'supplier');
 for item in select value from jsonb_array_elements(p->'items') loop
 ing:=(item->>'ingredient_id')::uuid;if not exists(select 1 from ingredients where id=ing and bakery_id=me.bakery_id) then raise exception 'Ingredient belongs to another bakery.';end if;
 insert into purchase_items(bakery_id,batch_id,ingredient_id,quantity,cost) values(me.bakery_id,entity,ing,event_integer(item,'quantity',1,1000000000),event_integer(item,'cost',0,1000000000));end loop;
 when 'ingredient_count','ingredient_adjustment' then
 ing:=(p->>'ingredient_id')::uuid;if not exists(select 1 from ingredients where id=ing and bakery_id=me.bakery_id) then raise exception 'Choose an ingredient in this bakery.';end if;
 if t='ingredient_count' then insert into ingredient_stock_counts values(entity,me.bakery_id,eid,ing,event_integer(p,'quantity',0,1000000000));
 else insert into ingredient_adjustments values(entity,me.bakery_id,eid,ing,event_integer(p,'quantity',-1000000000,1000000000),p->>'classification');end if;
 when 'expense' then insert into expenses values(entity,me.bakery_id,eid,p->>'category',event_integer(p,'amount',1,1000000000));
 when 'reversal' then
 select * into prior from sync_events where event_id=(p->>'event_id')::uuid and bakery_id=me.bakery_id;
 if prior.event_id is null or prior.event_type in ('reversal','receipt') or length(trim(coalesce(p->>'notes','')))<3 then raise exception 'This record cannot be reversed. Use an adjustment with a reason.';end if;
 if exists(select 1 from sync_events where bakery_id=me.bakery_id and event_type='reversal' and event_id<>eid and payload->>'event_id'=prior.event_id::text) then raise exception 'Already reversed.';end if;
 if prior.event_type in ('transfer','return') and exists(select 1 from transfer_confirmations where transfer_id=prior.entity_id) then raise exception 'Confirmed transfers need stock adjustments at both locations.';end if;
 if prior.event_type='sale' and exists(select 1 from payments pay where sale_id=prior.entity_id and event_id<>prior.event_id and not exists(select 1 from sync_events r where r.event_type='reversal' and r.bakery_id=me.bakery_id and r.payload->>'event_id'=pay.event_id::text)) then raise exception 'Reverse later payments before reversing this sale.';end if;
 if prior.event_type='sale' then update sales set voided=true where id=prior.entity_id;end if;
 if prior.event_type in ('transfer','return') then update bread_transfers set status='cancelled' where id=prior.entity_id;end if;
 else raise exception 'Unsupported action.';end case;
 insert into audit_log(bakery_id,user_id,action,detail) values(me.bakery_id,me.user_id,t,jsonb_build_object('event_id',eid));
 result:=result||jsonb_build_array(jsonb_build_object('event_id',eid,'accepted',true,'server_seq',seq));
 exception when others then
 -- This nested block rolls back the event AND all projections before returning a rejection.
 result:=result||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','accepted',false,'error',case when sqlstate='P0001' then sqlerrm else 'Record failed validation. Check values and linked records.' end));
 end;
 end loop;return result;
end$$;
create function public.pull_events(after_seq bigint default 0) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$declare me profiles;rows jsonb;cursor bigint;more boolean;begin
 select * into me from profiles where user_id=auth.uid();if me.user_id is null then raise exception 'Sign in and join a bakery.';end if;
 if after_seq<0 then raise exception 'Invalid cursor.';end if;
 perform pg_advisory_xact_lock(hashtextextended(me.bakery_id::text,0));
 select * into me from profiles where user_id=auth.uid();
 select coalesce(jsonb_agg(to_jsonb(e) order by server_seq),'[]'),coalesce(max(server_seq),after_seq) into rows,cursor from
 (select * from sync_events where bakery_id=me.bakery_id and server_seq>after_seq and (me.role in ('owner','manager') or user_id=me.user_id or payload->>'destination'=me.location_id::text or (event_type='reversal' and exists(select 1 from sync_events original where original.event_id::text=sync_events.payload->>'event_id' and (original.user_id=me.user_id or original.payload->>'destination'=me.location_id::text)))) order by server_seq limit 100)e;
 select exists(select 1 from sync_events where bakery_id=me.bakery_id and server_seq>cursor and (me.role in ('owner','manager') or user_id=me.user_id or payload->>'destination'=me.location_id::text or (event_type='reversal' and exists(select 1 from sync_events original where original.event_id::text=sync_events.payload->>'event_id' and (original.user_id=me.user_id or original.payload->>'destination'=me.location_id::text))))) into more;
 return jsonb_build_object('events',rows,'next_cursor',cursor,'has_more',more);
end$$;
-- Explicit allowlist: no helper/definer function is callable merely because it exists.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_bakery(),public.my_role(),public.create_bakery(text,text),public.invite_user(text,text),public.accept_invitation(text,text),public.owner_config(text,jsonb),public.push_events(jsonb),public.pull_events(bigint) to authenticated;
commit;
