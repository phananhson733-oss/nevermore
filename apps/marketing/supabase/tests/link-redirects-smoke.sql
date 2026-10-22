-- Run only in a disposable loopback database; every fixture is rolled back.
begin;
do $$ begin
  if current_database() not like 'signalframe_ci_%' then raise exception 'Disposable test database required'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.link_redirects'::regclass) then raise exception 'RLS required'; end if;
  if has_table_privilege('anon', 'public.link_redirects', 'SELECT')
    or has_table_privilege('authenticated', 'public.link_redirects', 'INSERT')
    or has_table_privilege('service_role', 'public.link_redirects', 'UPDATE') then raise exception 'Unexpected permissions'; end if;
end $$;
set local role service_role;
insert into public.link_redirects(code, destination_url) values ('q1testfixture01', 'https://gengrowth.ai/?utm_source=sql-smoke');
do $$ begin
  if (select count(*) from public.link_redirects where code = 'q1testfixture01') <> 1 then raise exception 'Readback failed'; end if;
  begin
    insert into public.link_redirects(code, destination_url) values ('q1testfixture01', 'https://gengrowth.ai/');
    raise exception 'Duplicate key accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.link_redirects(code, destination_url) values ('bad-target', 'https://gengrowth.ai.evil.example/');
    raise exception 'Foreign destination accepted';
  exception when check_violation then null; end;
end $$;
rollback;
