begin;
create function public.owner_overview() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin
 if my_role() is distinct from 'owner' then raise exception 'Owner access required.';end if;
 return jsonb_build_array(jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from profiles p where bakery_id=my_bakery())),jsonb_build_object('devices',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from devices d where bakery_id=my_bakery())),jsonb_build_object('audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select * from audit_log where bakery_id=my_bakery() order by created_at desc limit 100)a)));
end$$;
revoke all on function public.owner_overview() from public,anon;
grant execute on function public.owner_overview() to authenticated;
commit;
