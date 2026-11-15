begin;

create table public.bakeries(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 120),created_at timestamptz not null default now());
create table public.stock_locations(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,name text not null check(length(trim(name)) between 1 and 120),kind text not null check(kind in ('bakery','seller')),unique(id,bakery_id));
create unique index one_central on public.stock_locations(bakery_id) where kind='bakery';
create table public.profiles(user_id uuid primary key references auth.users,bakery_id uuid not null references public.bakeries,role text not null check(role in ('owner','manager','seller')),location_id uuid not null,name text not null,foreign key(location_id,bakery_id) references public.stock_locations(id,bakery_id));
create table public.invitations(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,token_hash bytea not null unique,email text not null,role text not null check(role in ('manager','seller')),expires_at timestamptz not null default now()+interval '7 days',used_at timestamptz);
create table public.devices(id uuid primary key,bakery_id uuid not null references public.bakeries,user_id uuid not null references auth.users,revoked boolean not null default false,last_seen timestamptz not null default now());
create table public.ingredients(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,name text not null check(length(trim(name)) between 1 and 120),unit text not null check(length(trim(unit)) between 1 and 30),scale integer not null check(scale between 1 and 1000000),unique(bakery_id,name));
create table public.bakery_settings(id uuid primary key default gen_random_uuid(),bakery_id uuid not null unique references public.bakeries,default_price bigint check(default_price between 0 and 1000000000));
create table public.expense_categories(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,name text not null,unique(bakery_id,name));
create table public.sync_events(server_seq bigint generated always as identity primary key,event_id uuid not null unique,entity_id uuid not null unique,device_id uuid not null references public.devices,user_id uuid not null references auth.users,bakery_id uuid not null references public.bakeries,location_id uuid not null references public.stock_locations,event_type text not null,schema_version integer not null check(schema_version=1),payload jsonb not null,client_created_at timestamptz not null,effective_at timestamptz not null,received_at timestamptz not null default now());
create index events_bakery_seq on public.sync_events(bakery_id,server_seq);
create table public.production_batches(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),quantity integer not null check(quantity>0));
create table public.bread_transfers(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),reference text not null,source uuid not null references public.stock_locations,destination uuid not null references public.stock_locations,quantity_sent integer not null check(quantity_sent>0),quantity_received integer check(quantity_received>=0),status text not null default 'pending' check(status in ('pending','confirmed','disputed','cancelled')),check(source<>destination),unique(bakery_id,reference));
create table public.transfer_confirmations(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),transfer_id uuid not null unique references public.bread_transfers,quantity integer not null check(quantity>=0));
create table public.customers(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,name text not null,unique(bakery_id,name));
create table public.sales(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),location_id uuid not null references public.stock_locations,seller_id uuid not null references auth.users,customer_id uuid references public.customers,quantity integer not null check(quantity>0),unit_price bigint not null check(unit_price>=0),total bigint generated always as (quantity::bigint*unit_price) stored,kind text not null check(kind in ('retail','wholesale')),voided boolean not null default false);
create table public.payments(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null references public.sync_events(event_id),sale_id uuid not null references public.sales,amount bigint not null check(amount>0),method text not null check(method in ('cash','mobile_money')),unique(event_id,sale_id));
create table public.bread_stock_counts(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),location_id uuid not null references public.stock_locations,quantity integer not null check(quantity>=0));
create table public.bread_adjustments(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),location_id uuid not null references public.stock_locations,quantity integer not null,reason text not null);
create table public.purchase_batches(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),supplier text);
create table public.purchase_items(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,batch_id uuid not null references public.purchase_batches,ingredient_id uuid not null references public.ingredients,quantity bigint not null check(quantity>0),cost bigint not null check(cost>=0));
create table public.ingredient_stock_counts(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),ingredient_id uuid not null references public.ingredients,quantity bigint not null check(quantity>=0));
create table public.ingredient_adjustments(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),ingredient_id uuid not null references public.ingredients,quantity bigint not null,classification text not null check(classification in ('estimated_production_use','wastage','spoilage','measurement_discrepancy','other')));
create table public.expenses(id uuid primary key,bakery_id uuid not null references public.bakeries,event_id uuid not null unique references public.sync_events(event_id),category text not null check(category in ('Transport','Electricity','Water','Fuel','Wages','Repairs','Packaging','Other')),amount bigint not null check(amount>0));
create table public.sync_conflicts(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,event_id uuid references public.sync_events(event_id),reason text not null,resolution_event_id uuid references public.sync_events(event_id),created_at timestamptz not null default now());
create table public.audit_log(id uuid primary key default gen_random_uuid(),bakery_id uuid not null references public.bakeries,user_id uuid not null references auth.users,action text not null,detail jsonb not null default '{}',created_at timestamptz not null default now());
create function public.my_bakery() returns uuid language sql stable security definer set search_path=public,pg_temp as $$select bakery_id from public.profiles where user_id=auth.uid()$$;
create function public.my_role() returns text language sql stable security definer set search_path=public,pg_temp as $$select role from public.profiles where user_id=auth.uid()$$;
-- Tables are read-only to clients. All writes go through checked RPCs.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('bakeries','profiles','invitations','sync_events','sales','payments','bread_transfers','transfer_confirmations','bread_stock_counts','bread_adjustments','devices','audit_log','sync_conflicts') loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy read_manager on public.%I for select to authenticated using (bakery_id=public.my_bakery() and public.my_role() in (''owner'',''manager''))',t);
 end loop;
end$$;
grant select on public.profiles,public.stock_locations,public.ingredients to authenticated;
create policy profile_read on public.profiles for select to authenticated using(user_id=auth.uid() or (bakery_id=public.my_bakery() and public.my_role() in ('owner','manager')));
create policy location_read on public.stock_locations for select to authenticated using(bakery_id=public.my_bakery());
grant select on public.bakery_settings to authenticated;
create policy settings_read on public.bakery_settings for select to authenticated using(bakery_id=public.my_bakery());
create policy ingredient_read on public.ingredients for select to authenticated using(bakery_id=public.my_bakery());
create function public.create_bakery(bakery_name text,person_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare b uuid;l uuid;begin
 if auth.uid() is null or exists(select 1 from profiles where user_id=auth.uid()) then raise exception 'Sign in with an account that has no bakery.';end if;
 if length(trim(bakery_name)) not between 1 and 120 or length(trim(person_name)) not between 1 and 120 then raise exception 'Enter a name.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 insert into bakeries(name) values(trim(bakery_name)) returning id into b;
 insert into stock_locations(bakery_id,name,kind) values(b,'Bakery','bakery') returning id into l;
 insert into profiles values(auth.uid(),b,'owner',l,trim(person_name));
 insert into bakery_settings(bakery_id) values(b);
 insert into audit_log(bakery_id,user_id,action) values(b,auth.uid(),'bakery_created');
end$$;
create function public.invite_user(invite_email text,invite_role text) returns text language plpgsql security definer set search_path=public,pg_temp as $$declare token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');begin
 if my_role() is distinct from 'owner' or invite_role not in ('manager','seller') then raise exception 'Owner access required.';end if;
 insert into invitations(bakery_id,token_hash,email,role) values(my_bakery(),sha256(convert_to(token,'UTF8')),lower(trim(invite_email)),invite_role);
 insert into audit_log(bakery_id,user_id,action,detail) values(my_bakery(),auth.uid(),'invitation_created',jsonb_build_object('email',invite_email,'role',invite_role));return token;
end$$;
create function public.accept_invitation(invite_token text,person_name text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare i invitations;l uuid;begin
 if auth.uid() is null or exists(select 1 from profiles where user_id=auth.uid()) then raise exception 'Account already belongs to a bakery.';end if;
 select * into i from invitations where token_hash=sha256(convert_to(invite_token,'UTF8')) and used_at is null and expires_at>now() for update;
 if i.id is null or i.email<>lower(auth.jwt()->>'email') or length(trim(person_name)) not between 1 and 120 then raise exception 'Invitation is invalid, expired, or for another email.';end if;
 if i.role='seller' then insert into stock_locations(bakery_id,name,kind) values(i.bakery_id,person_name,'seller') returning id into l;else select id into l from stock_locations where bakery_id=i.bakery_id and kind='bakery';end if;
 insert into profiles values(auth.uid(),i.bakery_id,i.role,l,person_name);update invitations set used_at=now() where id=i.id;
 insert into audit_log(bakery_id,user_id,action) values(i.bakery_id,auth.uid(),'invitation_accepted');
end$$;
create function public.owner_config(action text,body jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare target profiles;l uuid;begin
 if my_role() is distinct from 'owner' then raise exception 'Owner access required.';end if;
 if action='ingredient' then insert into ingredients(bakery_id,name,unit,scale) values(my_bakery(),body->>'name',body->>'unit',public.event_integer(body,'scale',1,1000000)::integer);
 elsif action='price' then update bakery_settings set default_price=public.event_integer(body,'price',0,1000000000) where bakery_id=my_bakery();
 elsif action='location' then update stock_locations set name=body->>'name' where id=(body->>'location_id')::uuid and bakery_id=my_bakery();
 elsif action='revoke_device' then update devices set revoked=true where id=(body->>'device_id')::uuid and bakery_id=my_bakery();
 elsif action='role' then
 select * into target from profiles where user_id=(body->>'user_id')::uuid and bakery_id=my_bakery() for update;
 if target.user_id is null or target.role='owner' or body->>'role' not in ('manager','seller') then raise exception 'Cannot change this role.';end if;
 -- Historical locations remain in the ledger; reconcile bread before changing roles.
 if target.role<>body->>'role' then
 perform pg_advisory_xact_lock(hashtextextended(my_bakery()::text,0));
 if body->>'role'='seller' then insert into stock_locations(bakery_id,name,kind) values(my_bakery(),target.name,'seller') returning id into l;else select id into l from stock_locations where bakery_id=my_bakery() and kind='bakery';end if;
 update profiles set role=body->>'role',location_id=l where user_id=target.user_id;
 end if;
 else raise exception 'Unknown configuration action.';end if;
 insert into audit_log(bakery_id,user_id,action,detail) values(my_bakery(),auth.uid(),action,body);
end$$;
commit;
